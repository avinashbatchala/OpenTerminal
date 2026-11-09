import { describe, expect, it } from "vitest";
import type { BrokerOrderRequest, BrokerOrderUpdate } from "../../ports/broker.js";
import { asClientOrderId } from "../../ports/broker.js";
import { brokerContract } from "../brokerContract.js";
import { createPaperBroker } from "./broker.js";
import { modelFill, type FillModelConfig, type FillModelQuote } from "./fillModel.js";

const NOW = new Date("2026-11-09T15:00:00.000Z");
const CONTRACT = "AAPL261120C00100000";

const QUOTES = new Map<string, FillModelQuote>([
  [
    CONTRACT,
    {
      contractSymbol: CONTRACT,
      bid: 1,
      ask: 1.2,
      quoteTime: NOW.toISOString(),
      multiplier: 100,
    },
  ],
]);

const CONFIG: FillModelConfig = {
  spreadFactor: 1,
  impactBps: 0,
  jitterBps: 0,
  maxSlippagePct: 50,
  maxQuoteAgeMs: 60_000,
  fees: { perOrderUsd: 0.65, perContractUsd: 0.15 },
};

function request(clientOrderId: string, overrides: Partial<BrokerOrderRequest> = {}): BrokerOrderRequest {
  return {
    clientOrderId: asClientOrderId(clientOrderId),
    intent: "open",
    assetClass: "option",
    instrument: { underlying: "AAPL", expiry: "2026-11-20" },
    legs: [{ contractSymbol: CONTRACT, side: "buy", quantity: 1 }],
    orderType: "limit",
    netLimitPrice: 2,
    timeInForce: "day",
    ...overrides,
  };
}

let counter = 0;

function createBroker(scenario: "fill" | "reject") {
  return createPaperBroker({
    fill: (order, at) =>
      scenario === "reject"
        ? {
            ok: false,
            error: { kind: "missing_quote", contractSymbol: order.legs[0].contractSymbol },
          }
        : modelFill({ request: order, quotes: QUOTES, now: at, config: CONFIG, seed: "paper-test" }),
    now: () => NOW,
    startingCashUsd: 10_000,
    idFactory: () => `order-${(counter += 1)}`,
  });
}

brokerContract("paper broker", createBroker);

describe("paper broker specifics", () => {
  it("rejects an order whose modeled price is worse than the limit", async () => {
    const broker = createBroker("fill");
    const updates: BrokerOrderUpdate[] = [];
    broker.subscribe((update) => updates.push(update));

    const result = await broker.submit(request("limit-order", { netLimitPrice: 1 }));
    expect(result.ok).toBe(true);
    expect(updates.map((update) => update.kind)).toEqual(["acknowledged", "rejected"]);
    const rejected = updates[1];
    if (rejected.kind !== "rejected") throw new Error("expected rejection");
    expect(rejected.error.kind).toBe("rejected");
    expect(rejected.error.code).toBe("limit_not_met");
  });

  it("debits cash and records the position after a fill", async () => {
    const broker = createBroker("fill");
    await broker.submit(request("cash-order"));
    const snapshot = await broker.snapshot();
    if (!snapshot.ok) throw new Error("snapshot failed");

    // 1 contract at 1.20 (ask) x 100 + 0.65 order fee + 0.15 contract fee.
    expect(snapshot.value.cashUsd).toBe(9_879.2);
    expect(snapshot.value.positions).toEqual([
      { contractSymbol: CONTRACT, quantity: 1, averagePrice: 1.2, multiplier: 100 },
    ]);
  });

  it("refuses to cancel a filled order", async () => {
    const broker = createBroker("fill");
    const result = await broker.submit(request("cancel-filled"));
    if (!result.ok) throw new Error("submit failed");
    const cancelled = await broker.cancel(result.value.brokerOrderId);
    expect(cancelled.ok).toBe(false);
  });
});
