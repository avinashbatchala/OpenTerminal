import type {
  BrokerFill,
  BrokerOrderId,
  BrokerOrderRequest,
  BrokerOrderUpdate,
  BrokerError,
  FillId,
  Result,
} from "../ports/broker.js";
import { err, ok } from "../ports/broker.js";

/**
 * Broker-agnostic order lifecycle. Both the paper adapter and a future live
 * adapter drive the same states through `applyBrokerUpdate`.
 */

export type OrderFill = {
  fillId: FillId;
  contractSymbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  multiplier: number;
  feesUsd: number;
  at: string;
};

export type OrderState =
  | { status: "submitted"; request: BrokerOrderRequest; submittedAt: string }
  | {
      status: "acknowledged";
      request: BrokerOrderRequest;
      brokerOrderId: BrokerOrderId;
      fills: readonly OrderFill[];
      submittedAt: string;
      at: string;
    }
  | {
      status: "partially_filled";
      request: BrokerOrderRequest;
      brokerOrderId: BrokerOrderId;
      fills: readonly OrderFill[];
      filled: number;
      remaining: number;
      submittedAt: string;
      at: string;
    }
  | {
      status: "filled";
      request: BrokerOrderRequest;
      brokerOrderId: BrokerOrderId;
      fills: readonly OrderFill[];
      submittedAt: string;
      at: string;
    }
  | {
      status: "cancelled";
      request: BrokerOrderRequest;
      brokerOrderId: BrokerOrderId;
      fills: readonly OrderFill[];
      submittedAt: string;
      at: string;
    }
  | {
      status: "expired";
      request: BrokerOrderRequest;
      brokerOrderId: BrokerOrderId;
      fills: readonly OrderFill[];
      submittedAt: string;
      at: string;
    }
  | {
      status: "rejected";
      request: BrokerOrderRequest;
      brokerOrderId: BrokerOrderId | null;
      fills: readonly OrderFill[];
      error: BrokerError;
      submittedAt: string;
      at: string;
    };

export type OrderTransitionError =
  | {
      kind: "invalid_transition";
      from: OrderState["status"];
      update: BrokerOrderUpdate["kind"];
      message: string;
    }
  | { kind: "invalid_fill"; message: string };

export function submittedOrder(request: BrokerOrderRequest, at: string): OrderState {
  return { status: "submitted", request, submittedAt: at };
}

export function requiredQuantity(request: BrokerOrderRequest): number {
  return request.legs.reduce((total, leg) => total + leg.quantity, 0);
}

export function fillsOf(state: OrderState): readonly OrderFill[] {
  return "fills" in state ? state.fills : [];
}

function toOrderFill(fill: BrokerFill): OrderFill {
  return {
    fillId: fill.fillId,
    contractSymbol: fill.contractSymbol,
    side: fill.side,
    quantity: fill.quantity,
    price: fill.price,
    multiplier: fill.multiplier,
    feesUsd: fill.feesUsd,
    at: fill.at,
  };
}

function validateFill(fill: BrokerFill): string | null {
  if (!fill.contractSymbol.trim()) return "fill contract symbol is empty";
  if (!Number.isFinite(fill.quantity) || fill.quantity <= 0) return "fill quantity must be positive";
  if (!Number.isFinite(fill.price) || fill.price <= 0) return "fill price must be positive";
  if (!Number.isFinite(fill.multiplier) || fill.multiplier <= 0) return "fill multiplier must be positive";
  if (!Number.isFinite(fill.feesUsd) || fill.feesUsd < 0) return "fill fees must be non-negative";
  if (!Number.isFinite(Date.parse(fill.at))) return "fill timestamp is unreadable";
  return null;
}

/**
 * Apply a normalized broker update. Duplicate acknowledgements are idempotent;
 * every other transition is validated so a late or duplicated frame can never
 * resurrect a terminal order.
 */
export function applyBrokerUpdate(
  state: OrderState,
  update: BrokerOrderUpdate
): Result<OrderState, OrderTransitionError> {
  switch (update.kind) {
    case "acknowledged": {
      if (state.status === "acknowledged") {
        return state.brokerOrderId === update.brokerOrderId
          ? ok(state)
          : err({
              kind: "invalid_transition",
              from: state.status,
              update: update.kind,
              message: "order was acknowledged with a different broker id",
            });
      }
      if (state.status !== "submitted") {
        return err({
          kind: "invalid_transition",
          from: state.status,
          update: update.kind,
          message: "only a submitted order can be acknowledged",
        });
      }
      return ok({
        status: "acknowledged",
        request: state.request,
        brokerOrderId: update.brokerOrderId,
        fills: [],
        submittedAt: state.submittedAt,
        at: update.at,
      });
    }

    case "fill": {
      if (state.status !== "acknowledged" && state.status !== "partially_filled") {
        return err({
          kind: "invalid_transition",
          from: state.status,
          update: update.kind,
          message: "fills require an acknowledged, unfilled order",
        });
      }
      if (update.brokerOrderId !== state.brokerOrderId) {
        return err({
          kind: "invalid_transition",
          from: state.status,
          update: update.kind,
          message: "fill references a different broker order id",
        });
      }
      for (const fill of update.fills) {
        const issue = validateFill(fill);
        if (issue) return err({ kind: "invalid_fill", message: issue });
      }
      if (update.fills.length === 0) {
        return err({ kind: "invalid_fill", message: "fill update contained no fills" });
      }

      const fills = [...fillsOf(state), ...update.fills.map(toOrderFill)];
      const filled = fills.reduce((total, fill) => total + fill.quantity, 0);
      const required = requiredQuantity(state.request);
      if (filled > required) {
        return err({
          kind: "invalid_fill",
          message: `filled ${filled} exceeds requested ${required}`,
        });
      }

      if (filled >= required) {
        return ok({
          status: "filled",
          request: state.request,
          brokerOrderId: state.brokerOrderId,
          fills,
          submittedAt: state.submittedAt,
          at: update.at,
        });
      }
      return ok({
        status: "partially_filled",
        request: state.request,
        brokerOrderId: state.brokerOrderId,
        fills,
        filled,
        remaining: required - filled,
        submittedAt: state.submittedAt,
        at: update.at,
      });
    }

    case "rejected": {
      if (state.status === "filled" || state.status === "cancelled" || state.status === "expired") {
        return err({
          kind: "invalid_transition",
          from: state.status,
          update: update.kind,
          message: "terminal order cannot be rejected",
        });
      }
      return ok({
        status: "rejected",
        request: state.request,
        brokerOrderId: update.brokerOrderId,
        fills: fillsOf(state),
        error: update.error,
        submittedAt: state.submittedAt,
        at: update.at,
      });
    }

    case "cancelled":
    case "expired": {
      if (state.status !== "acknowledged" && state.status !== "partially_filled") {
        return err({
          kind: "invalid_transition",
          from: state.status,
          update: update.kind,
          message: `only an open order can be ${update.kind}`,
        });
      }
      if (update.brokerOrderId !== state.brokerOrderId) {
        return err({
          kind: "invalid_transition",
          from: state.status,
          update: update.kind,
          message: `order ${update.kind} references a different broker order id`,
        });
      }
      return ok({
        status: update.kind === "cancelled" ? "cancelled" : "expired",
        request: state.request,
        brokerOrderId: state.brokerOrderId,
        fills: fillsOf(state),
        submittedAt: state.submittedAt,
        at: update.at,
      });
    }

    default:
      return assertNeverUpdate(update);
  }
}

function assertNeverUpdate(update: never): never {
  throw new Error(`Unhandled broker update: ${JSON.stringify(update)}`);
}
