import { describe, expect, it } from "vitest";
import type {
  BrokerOrderRequest,
  BrokerOrderUpdate,
  BrokerPort,
} from "../ports/broker.js";
import { asBrokerOrderId, asClientOrderId } from "../ports/broker.js";

export type BrokerContractScenario = "fill" | "reject";

function request(clientOrderId: string): BrokerOrderRequest {
  return {
    clientOrderId: asClientOrderId(clientOrderId),
    intent: "open",
    assetClass: "option",
    legs: [
      {
        contractSymbol: "AAPL261120C00100000",
        side: "buy",
        quantity: 1,
      },
    ],
    orderType: "limit",
    netLimitPrice: 2,
    timeInForce: "day",
  };
}

function collect(broker: BrokerPort): BrokerOrderUpdate[] {
  const updates: BrokerOrderUpdate[] = [];
  broker.subscribe((update) => updates.push(update));
  return updates;
}

/**
 * Every adapter (paper today, live later) must pass this suite. It only uses
 * the public port, so it is safe to reuse against a mocked live transport.
 */
export function brokerContract(
  name: string,
  createBroker: (scenario: BrokerContractScenario) => BrokerPort
): void {
  describe(name, () => {
    it("declares option and multi-leg support", () => {
      const capabilities = createBroker("fill").capabilities();
      expect(capabilities.assetClasses).toContain("option");
      expect(capabilities.supportsMultiLeg).toBe(true);
      expect(capabilities.orderTypes).toContain("limit");
    });

    it("acknowledges before emitting fills", async () => {
      const broker = createBroker("fill");
      const updates = collect(broker);

      const result = await broker.submit(request("contract-ack"));
      expect(result.ok).toBe(true);

      expect(updates.map((update) => update.kind)).toEqual(["acknowledged", "fill"]);
      const fill = updates[1];
      if (fill.kind !== "fill") throw new Error("expected a fill");
      expect(fill.fills.reduce((total, leg) => total + leg.quantity, 0)).toBe(1);
    });

    it("honours clientOrderId idempotency", async () => {
      const broker = createBroker("fill");
      const updates = collect(broker);

      const first = await broker.submit(request("contract-idempotent"));
      const second = await broker.submit(request("contract-idempotent"));

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(second.value.brokerOrderId).toBe(first.value.brokerOrderId);
      expect(updates.filter((update) => update.kind === "acknowledged")).toHaveLength(1);
      expect(updates.filter((update) => update.kind === "fill")).toHaveLength(1);
    });

    it("normalizes a fill rejection into a broker error", async () => {
      const broker = createBroker("reject");
      const updates = collect(broker);

      const result = await broker.submit(request("contract-reject"));
      expect(result.ok).toBe(true);

      expect(updates.map((update) => update.kind)).toEqual(["acknowledged", "rejected"]);
      const rejected = updates[1];
      if (rejected.kind !== "rejected") throw new Error("expected a rejection");
      expect(rejected.error.message).not.toHaveLength(0);
    });

    it("reports positions and cash in the snapshot", async () => {
      const broker = createBroker("fill");
      await broker.submit(request("contract-snapshot"));

      const snapshot = await broker.snapshot();
      expect(snapshot.ok).toBe(true);
      if (!snapshot.ok) return;

      expect(snapshot.value.positions).toHaveLength(1);
      expect(snapshot.value.positions[0].contractSymbol).toBe("AAPL261120C00100000");
      expect(snapshot.value.positions[0].quantity).toBe(1);
      expect(Number.isFinite(snapshot.value.cashUsd)).toBe(true);
      expect(snapshot.value.openOrders).toHaveLength(0);
    });

    it("rejects cancelling an unknown order", async () => {
      const broker = createBroker("fill");
      const result = await broker.cancel(asBrokerOrderId("missing-order"));
      expect(result.ok).toBe(false);
    });
  });
}
