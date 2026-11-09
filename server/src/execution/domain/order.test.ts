import { describe, expect, it } from "vitest";
import type {
  BrokerFill,
  BrokerOrderRequest,
  BrokerOrderUpdate,
} from "../ports/broker.js";
import { asBrokerOrderId, asClientOrderId, asFillId } from "../ports/broker.js";
import { applyBrokerUpdate, submittedOrder, type OrderState } from "./order.js";

const AT = "2026-11-09T15:00:00.000Z";
const BROKER_ID = asBrokerOrderId("broker-1");

const REQUEST: BrokerOrderRequest = {
  clientOrderId: asClientOrderId("client-1"),
  intent: "open",
  assetClass: "option",
  legs: [{ contractSymbol: "AAPL261120C00100000", side: "buy", quantity: 2 }],
  orderType: "limit",
  netLimitPrice: 2,
  timeInForce: "day",
};

function fill(quantity: number, id: string): BrokerFill {
  return {
    fillId: asFillId(id),
    contractSymbol: "AAPL261120C00100000",
    side: "buy",
    quantity,
    price: 1.2,
    multiplier: 100,
    feesUsd: 0.8,
    at: AT,
  };
}

function ack(): BrokerOrderUpdate {
  return { kind: "acknowledged", brokerOrderId: BROKER_ID, at: AT };
}

function requireState(state: OrderState, status: OrderState["status"]) {
  expect(state.status).toBe(status);
  return state;
}

describe("order lifecycle", () => {
  it("moves submitted -> acknowledged -> filled", () => {
    const submitted = submittedOrder(REQUEST, AT);
    const acknowledged = applyBrokerUpdate(submitted, ack());
    if (!acknowledged.ok) throw new Error("ack failed");

    const filled = applyBrokerUpdate(acknowledged.value, {
      kind: "fill",
      brokerOrderId: BROKER_ID,
      fills: [fill(2, "fill-1")],
      at: AT,
    });
    if (!filled.ok) throw new Error("fill failed");
    expect(filled.value.status).toBe("filled");
    expect(filled.value.status === "filled" && filled.value.fills).toHaveLength(1);
  });

  it("tracks partial fills and their remaining quantity", () => {
    const acknowledged = applyBrokerUpdate(submittedOrder(REQUEST, AT), ack());
    if (!acknowledged.ok) throw new Error("ack failed");

    const partial = applyBrokerUpdate(acknowledged.value, {
      kind: "fill",
      brokerOrderId: BROKER_ID,
      fills: [fill(1, "fill-1")],
      at: AT,
    });
    if (!partial.ok) throw new Error("partial failed");
    const partialState = requireState(partial.value, "partially_filled");
    expect(partialState.status === "partially_filled" && partialState.remaining).toBe(1);

    const filled = applyBrokerUpdate(partial.value, {
      kind: "fill",
      brokerOrderId: BROKER_ID,
      fills: [fill(1, "fill-2")],
      at: AT,
    });
    if (!filled.ok) throw new Error("second fill failed");
    expect(filled.value.status).toBe("filled");
  });

  it("rejects overfills and fills before acknowledgement", () => {
    const overfill = applyBrokerUpdate(submittedOrder(REQUEST, AT), {
      kind: "fill",
      brokerOrderId: BROKER_ID,
      fills: [fill(1, "fill-1")],
      at: AT,
    });
    expect(overfill.ok).toBe(false);
    if (!overfill.ok) expect(overfill.error.kind).toBe("invalid_transition");

    const acked = applyBrokerUpdate(submittedOrder(REQUEST, AT), ack());
    if (!acked.ok) throw new Error("ack failed");
    const tooMuch = applyBrokerUpdate(acked.value, {
      kind: "fill",
      brokerOrderId: BROKER_ID,
      fills: [fill(3, "fill-1")],
      at: AT,
    });
    expect(tooMuch.ok).toBe(false);
    if (!tooMuch.ok) expect(tooMuch.error.kind).toBe("invalid_fill");
  });

  it("keeps executed fills when the remainder is cancelled or rejected", () => {
    const acknowledged = applyBrokerUpdate(submittedOrder(REQUEST, AT), ack());
    if (!acknowledged.ok) throw new Error("ack failed");
    const partial = applyBrokerUpdate(acknowledged.value, {
      kind: "fill",
      brokerOrderId: BROKER_ID,
      fills: [fill(1, "fill-1")],
      at: AT,
    });
    if (!partial.ok) throw new Error("partial failed");

    const cancelled = applyBrokerUpdate(partial.value, {
      kind: "cancelled",
      brokerOrderId: BROKER_ID,
      at: AT,
    });
    if (!cancelled.ok) throw new Error("cancel failed");
    expect(cancelled.value.status).toBe("cancelled");
    expect(cancelled.value.status === "cancelled" && cancelled.value.fills).toHaveLength(1);
  });

  it("treats a duplicate acknowledgement as idempotent", () => {
    const acknowledged = applyBrokerUpdate(submittedOrder(REQUEST, AT), ack());
    if (!acknowledged.ok) throw new Error("ack failed");
    const duplicate = applyBrokerUpdate(acknowledged.value, ack());
    expect(duplicate.ok).toBe(true);
  });

  it("cannot resurrect a filled order", () => {
    const acknowledged = applyBrokerUpdate(submittedOrder(REQUEST, AT), ack());
    if (!acknowledged.ok) throw new Error("ack failed");
    const filled = applyBrokerUpdate(acknowledged.value, {
      kind: "fill",
      brokerOrderId: BROKER_ID,
      fills: [fill(2, "fill-1")],
      at: AT,
    });
    if (!filled.ok) throw new Error("fill failed");

    const cancelled = applyBrokerUpdate(filled.value, {
      kind: "cancelled",
      brokerOrderId: BROKER_ID,
      at: AT,
    });
    expect(cancelled.ok).toBe(false);
  });
});
