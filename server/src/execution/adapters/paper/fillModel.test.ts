import { describe, expect, it } from "vitest";
import type { BrokerOrderRequest } from "../../ports/broker.js";
import { asClientOrderId } from "../../ports/broker.js";
import {
  marketableLimitPrice,
  modelFill,
  type FillModelConfig,
  type FillModelQuote,
} from "./fillModel.js";

const NOW = new Date("2026-11-09T15:00:00.000Z");
const CALL = "AAPL261120C00100000";
const PUT = "AAPL261120P00090000";

const BASE_CONFIG: FillModelConfig = {
  spreadFactor: 1,
  impactBps: 0,
  jitterBps: 0,
  maxSlippagePct: 50,
  maxQuoteAgeMs: 60_000,
  fees: { perOrderUsd: 0.65, perContractUsd: 0.15 },
};

function quote(
  contractSymbol: string,
  bid: number,
  ask: number,
  overrides: Partial<FillModelQuote> = {}
): FillModelQuote {
  return { contractSymbol, bid, ask, quoteTime: NOW.toISOString(), multiplier: 100, ...overrides };
}

function quotes(...rows: FillModelQuote[]): Map<string, FillModelQuote> {
  return new Map(rows.map((row) => [row.contractSymbol, row]));
}

function request(
  legs: BrokerOrderRequest["legs"],
  overrides: Partial<BrokerOrderRequest> = {}
): BrokerOrderRequest {
  return {
    clientOrderId: asClientOrderId("fill-test"),
    intent: "open",
    assetClass: "option",
    instrument: { underlying: "AAPL", expiry: "2026-11-20" },
    legs,
    orderType: "limit",
    netLimitPrice: null,
    timeInForce: "day",
    ...overrides,
  };
}

describe("paper fill model", () => {
  it("crosses the full spread at spreadFactor 1", () => {
    const result = modelFill({
      request: request([{ contractSymbol: CALL, side: "buy", quantity: 1 }]),
      quotes: quotes(quote(CALL, 1, 1.2)),
      now: NOW,
      config: BASE_CONFIG,
      seed: "s",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0].fillPrice).toBeCloseTo(1.2);

    const sell = modelFill({
      request: request([{ contractSymbol: CALL, side: "sell", quantity: 1 }]),
      quotes: quotes(quote(CALL, 1, 1.2)),
      now: NOW,
      config: BASE_CONFIG,
      seed: "s",
    });
    if (!sell.ok) throw new Error("sell fill failed");
    expect(sell.value.legs[0].fillPrice).toBeCloseTo(1);
  });

  it("fills at the mid when spreadFactor is 0", () => {
    const result = modelFill({
      request: request([{ contractSymbol: CALL, side: "buy", quantity: 1 }]),
      quotes: quotes(quote(CALL, 1, 1.2)),
      now: NOW,
      config: { ...BASE_CONFIG, spreadFactor: 0 },
      seed: "s",
    });
    if (!result.ok) throw new Error("fill failed");
    expect(result.value.legs[0].fillPrice).toBeCloseTo(1.1);
    expect(result.value.legs[0].referenceMid).toBeCloseTo(1.1);
  });

  it("adds adverse impact", () => {
    const result = modelFill({
      request: request([{ contractSymbol: CALL, side: "buy", quantity: 1 }]),
      quotes: quotes(quote(CALL, 1, 1.2)),
      now: NOW,
      config: { ...BASE_CONFIG, spreadFactor: 0, impactBps: 100 },
      seed: "s",
    });
    if (!result.ok) throw new Error("fill failed");
    expect(result.value.legs[0].fillPrice).toBeCloseTo(1.111);
  });

  it("is deterministic for a seed and bounded by the jitter setting", () => {
    const input = {
      request: request([{ contractSymbol: CALL, side: "buy", quantity: 1 }]),
      quotes: quotes(quote(CALL, 1, 1.2)),
      now: NOW,
      config: { ...BASE_CONFIG, spreadFactor: 0, jitterBps: 20 },
      seed: "repeatable",
    };
    const first = modelFill(input);
    const second = modelFill(input);
    if (!first.ok || !second.ok) throw new Error("jitter fill failed");

    expect(first.value.legs[0].fillPrice).toBe(second.value.legs[0].fillPrice);
    const deviationPct = Math.abs(first.value.legs[0].fillPrice - 1.1) / 1.1 * 100;
    expect(deviationPct).toBeLessThanOrEqual(20);
  });

  it("rejects stale quotes", () => {
    const result = modelFill({
      request: request([{ contractSymbol: CALL, side: "buy", quantity: 1 }]),
      quotes: quotes(quote(CALL, 1, 1.2, { quoteTime: new Date(NOW.getTime() - 120_000).toISOString() })),
      now: NOW,
      config: BASE_CONFIG,
      seed: "s",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("stale_quote");
  });

  it("rejects crossed or missing quotes", () => {
    const crossed = modelFill({
      request: request([{ contractSymbol: CALL, side: "buy", quantity: 1 }]),
      quotes: quotes(quote(CALL, 1.3, 1.2)),
      now: NOW,
      config: BASE_CONFIG,
      seed: "s",
    });
    expect(crossed.ok).toBe(false);
    if (!crossed.ok) expect(crossed.error.kind).toBe("invalid_quote");

    const missing = modelFill({
      request: request([{ contractSymbol: CALL, side: "buy", quantity: 1 }]),
      quotes: quotes(),
      now: NOW,
      config: BASE_CONFIG,
      seed: "s",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.kind).toBe("missing_quote");
  });

  it("rejects the whole package when one leg is missing", () => {
    const result = modelFill({
      request: request([
        { contractSymbol: CALL, side: "buy", quantity: 1 },
        { contractSymbol: PUT, side: "sell", quantity: 1 },
      ]),
      quotes: quotes(quote(CALL, 1, 1.2)),
      now: NOW,
      config: BASE_CONFIG,
      seed: "s",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("missing_quote");
  });

  it("enforces the slippage cap", () => {
    const result = modelFill({
      request: request([{ contractSymbol: CALL, side: "buy", quantity: 1 }]),
      quotes: quotes(quote(CALL, 1, 1.2)),
      now: NOW,
      config: { ...BASE_CONFIG, maxSlippagePct: 0 },
      seed: "s",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("slippage_limit");
  });

  it("charges one order fee plus a per-contract fee", () => {
    const result = modelFill({
      request: request([
        { contractSymbol: CALL, side: "buy", quantity: 1 },
        { contractSymbol: PUT, side: "sell", quantity: 2 },
      ]),
      quotes: quotes(quote(CALL, 1, 1.2), quote(PUT, 0.8, 1)),
      now: NOW,
      config: BASE_CONFIG,
      seed: "s",
    });
    if (!result.ok) throw new Error("fee fill failed");
    // 0.65 order + 0.15 * (1 + 2) contracts
    expect(result.value.summary.feesUsd).toBe(1.1);
  });

  it("reports net package price, mid price and slippage", () => {
    const result = modelFill({
      request: request([{ contractSymbol: CALL, side: "buy", quantity: 1 }]),
      quotes: quotes(quote(CALL, 1, 1.2)),
      now: NOW,
      config: BASE_CONFIG,
      seed: "s",
    });
    if (!result.ok) throw new Error("summary fill failed");
    expect(result.value.summary.netPricePerShare).toBeCloseTo(1.2);
    expect(result.value.summary.midPricePerShare).toBeCloseTo(1.1);
    expect(result.value.summary.slippageUsd).toBeCloseTo(10);
    expect(result.value.summary.slippagePctOfMid).toBeCloseTo(9.0909, 3);
  });

  it("prices a credit package negatively", () => {
    const result = modelFill({
      request: request(
        [{ contractSymbol: PUT, side: "sell", quantity: 1 }],
        { intent: "close" }
      ),
      quotes: quotes(quote(PUT, 0.8, 1)),
      now: NOW,
      config: BASE_CONFIG,
      seed: "s",
    });
    if (!result.ok) throw new Error("credit fill failed");
    expect(result.value.summary.netPricePerShare).toBeCloseTo(-0.8);
    expect(result.value.summary.slippageUsd).toBeCloseTo(10);
  });

  it("derives a buffered marketable limit from the modeled fill", () => {
    const result = modelFill({
      request: request([{ contractSymbol: CALL, side: "buy", quantity: 1 }]),
      quotes: quotes(quote(CALL, 1, 1.2)),
      now: NOW,
      config: BASE_CONFIG,
      seed: "s",
    });
    if (!result.ok) throw new Error("limit fill failed");
    expect(marketableLimitPrice(result.value, 10)).toBeCloseTo(1.32);
  });
});
