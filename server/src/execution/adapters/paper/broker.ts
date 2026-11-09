import { randomUUID } from "node:crypto";
import type {
  BrokerCapabilities,
  BrokerError,
  BrokerFill,
  BrokerOrderId,
  BrokerOrderLeg,
  BrokerOrderRequest,
  BrokerOpenOrder,
  BrokerOrderUpdate,
  BrokerPort,
  BrokerPosition,
  BrokerSnapshot,
  Result,
} from "../../ports/broker.js";
import { asBrokerOrderId, asFillId, asClientOrderId, err, ok } from "../../ports/broker.js";
import {
  applyBrokerUpdate,
  fillsOf,
  submittedOrder,
  type OrderState,
} from "../../domain/order.js";
import type { FillModelError, ModeledFill } from "./fillModel.js";

/**
 * In-memory paper broker. It is a full `BrokerPort`: the execution engine sees
 * acknowledgements and fill events exactly as it would from a live venue.
 */

export type PaperFillProvider = (
  request: BrokerOrderRequest,
  at: Date
) => Result<ModeledFill, FillModelError>;

export type PaperBrokerOptions = {
  fill: PaperFillProvider;
  now?: () => Date;
  startingCashUsd?: number;
  idFactory?: () => string;
};

const CAPABILITIES: BrokerCapabilities = {
  assetClasses: ["option"],
  supportsMultiLeg: true,
  supportsPartialFills: false,
  supportsCancel: true,
  orderTypes: ["limit"],
  fillDelivery: "push",
};

function normalizeFillError(error: FillModelError): BrokerError {
  switch (error.kind) {
    case "unsupported_asset":
      return { kind: "unsupported_order", message: `unsupported asset class: ${error.assetClass}` };
    case "invalid_config":
      return { kind: "unknown", message: error.message };
    case "missing_quote":
      return { kind: "rejected", code: "missing_quote", message: `No quote for ${error.contractSymbol}` };
    case "stale_quote":
      return {
        kind: "rejected",
        code: "stale_quote",
        message: `Quote for ${error.contractSymbol} is ${Math.round(error.ageSeconds)}s old`,
      };
    case "invalid_quote":
      return {
        kind: "rejected",
        code: "invalid_quote",
        message: `Invalid quote for ${error.contractSymbol}: ${error.message}`,
      };
    case "non_positive_price":
      return {
        kind: "rejected",
        code: "non_positive_price",
        message: `Modeled price is not positive for ${error.contractSymbol}`,
      };
    case "slippage_limit":
      return {
        kind: "rejected",
        code: "slippage_limit",
        message: `Modeled slippage ${error.slippagePct.toFixed(2)}% exceeds ${error.maxPct}%`,
      };
    case "invalid_fill":
      return { kind: "rejected", code: "invalid_fill", message: error.message };
  }
}

function validateRequest(request: BrokerOrderRequest): BrokerError | null {
  if (request.assetClass !== "option") {
    return { kind: "unsupported_order", message: `unsupported asset class: ${request.assetClass}` };
  }
  if (request.legs.length === 0) {
    return { kind: "rejected", code: "empty_order", message: "order has no legs" };
  }
  for (const leg of request.legs) {
    if (!leg.contractSymbol.trim()) {
      return { kind: "rejected", code: "invalid_leg", message: "leg contract symbol is empty" };
    }
    if (!Number.isFinite(leg.quantity) || leg.quantity <= 0) {
      return { kind: "rejected", code: "invalid_leg", message: "leg quantity must be positive" };
    }
  }
  return null;
}

function limitReached(request: BrokerOrderRequest, fill: ModeledFill): boolean {
  if (request.orderType !== "limit" || request.netLimitPrice === null) return false;
  // The net price is signed: positive debit, negative credit. Paying more than
  // the limit (or receiving less credit) is worse in both cases.
  return fill.summary.netPricePerShare > request.netLimitPrice;
}

export function createPaperBroker(options: PaperBrokerOptions): BrokerPort {
  const now = options.now ?? (() => new Date());
  const nextId = options.idFactory ?? (() => randomUUID());
  let cashUsd = options.startingCashUsd ?? 100_000;

  type Entry = { request: BrokerOrderRequest; state: OrderState };
  const orders = new Map<string, Entry>();
  const byBrokerId = new Map<string, string>();
  const listeners = new Set<(update: BrokerOrderUpdate) => void>();

  const emit = (update: BrokerOrderUpdate) => {
    for (const listener of listeners) listener(update);
  };

  const apply = (clientId: string, update: BrokerOrderUpdate): OrderState => {
    const entry = orders.get(clientId);
    if (!entry) throw new Error(`Unknown paper order ${clientId}`);
    const result = applyBrokerUpdate(entry.state, update);
    if (!result.ok) {
      throw new Error(`Invalid paper order transition: ${result.error.message}`);
    }
    entry.state = result.value;
    if ("brokerOrderId" in result.value && result.value.brokerOrderId) {
      byBrokerId.set(result.value.brokerOrderId, clientId);
    }
    return result.value;
  };

  const reject = (clientId: string, brokerOrderId: BrokerOrderId | null, error: BrokerError) => {
    const at = now().toISOString();
    const update: BrokerOrderUpdate = { kind: "rejected", brokerOrderId, error, at };
    apply(clientId, update);
    emit(update);
  };

  return {
    capabilities() {
      return CAPABILITIES;
    },

    async submit(request) {
      const existing = orders.get(request.clientOrderId);
      if (existing && "brokerOrderId" in existing.state && existing.state.brokerOrderId) {
        return ok({ brokerOrderId: existing.state.brokerOrderId });
      }

      const requestIssue = validateRequest(request);
      if (requestIssue) return err(requestIssue);

      const at = now();
      const brokerOrderId = asBrokerOrderId(nextId());
      const clientId = request.clientOrderId;
      orders.set(clientId, { request, state: submittedOrder(request, at.toISOString()) });

      const acknowledged: BrokerOrderUpdate = {
        kind: "acknowledged",
        brokerOrderId,
        at: at.toISOString(),
      };
      apply(clientId, acknowledged);
      emit(acknowledged);

      const modeled = options.fill(request, at);
      if (!modeled.ok) {
        reject(clientId, brokerOrderId, normalizeFillError(modeled.error));
        return ok({ brokerOrderId });
      }

      if (limitReached(request, modeled.value)) {
        reject(clientId, brokerOrderId, {
          kind: "rejected",
          code: "limit_not_met",
          message: "modeled package price is outside the limit",
        });
        return ok({ brokerOrderId });
      }

      const fills: BrokerFill[] = modeled.value.legs.map((leg, index) => ({
        fillId: asFillId(`${brokerOrderId}-${index}`),
        contractSymbol: leg.contractSymbol,
        side: leg.side,
        quantity: leg.quantity,
        price: leg.fillPrice,
        multiplier: leg.multiplier,
        feesUsd: leg.feesUsd,
        at: leg.at,
      }));

      const fillUpdate: BrokerOrderUpdate = {
        kind: "fill",
        brokerOrderId,
        fills,
        at: at.toISOString(),
      };
      apply(clientId, fillUpdate);
      emit(fillUpdate);
      return ok({ brokerOrderId });
    },

    async cancel(brokerOrderId) {
      const clientId = byBrokerId.get(brokerOrderId);
      if (!clientId) {
        return err({
          kind: "rejected",
          code: "unknown_order",
          message: `Unknown broker order ${brokerOrderId}`,
        });
      }
      const state = orders.get(clientId)?.state;
      if (!state || (state.status !== "acknowledged" && state.status !== "partially_filled")) {
        return err({
          kind: "rejected",
          code: "not_cancellable",
          message: `Order ${brokerOrderId} is not open`,
        });
      }
      const update: BrokerOrderUpdate = {
        kind: "cancelled",
        brokerOrderId,
        at: now().toISOString(),
      };
      apply(clientId, update);
      emit(update);
      return ok(undefined);
    },

    subscribe(onUpdate) {
      listeners.add(onUpdate);
      return () => {
        listeners.delete(onUpdate);
      };
    },

    async snapshot(): Promise<Result<BrokerSnapshot, BrokerError>> {
      const positions = new Map<string, { quantity: number; notional: number; multiplier: number }>();
      let cash = options.startingCashUsd ?? 100_000;
      const openOrders: BrokerOpenOrder[] = [];

      for (const entry of orders.values()) {
        const state = entry.state;
        if (state.status === "acknowledged" || state.status === "partially_filled") {
          openOrders.push({
            clientOrderId: asClientOrderId(entry.request.clientOrderId),
            brokerOrderId: state.brokerOrderId,
            status: state.status,
          });
        }
        for (const fill of fillsOf(state)) {
          const sign = fill.side === "buy" ? 1 : -1;
          cash -= sign * fill.price * fill.quantity * fill.multiplier;
          cash -= fill.feesUsd;

          const current = positions.get(fill.contractSymbol) ?? {
            quantity: 0,
            notional: 0,
            multiplier: fill.multiplier,
          };
          current.quantity += sign * fill.quantity;
          current.notional += fill.price * fill.quantity;
          current.multiplier = fill.multiplier;
          positions.set(fill.contractSymbol, current);
        }
      }

      const brokerPositions: BrokerPosition[] = [...positions.entries()]
        .filter(([, value]) => value.quantity !== 0)
        .map(([contractSymbol, value]) => ({
          contractSymbol,
          quantity: value.quantity,
          averagePrice:
            value.quantity === 0
              ? 0
              : Math.round((Math.abs(value.notional) / Math.abs(value.quantity)) * 10_000) / 10_000,
          multiplier: value.multiplier,
        }));

      return ok({
        asOf: now().toISOString(),
        cashUsd: Math.round((cash + Number.EPSILON) * 100) / 100,
        positions: brokerPositions,
        openOrders,
      });
    },
  };
}

/** Convenience for tests and the future live adapter: a deterministic leg list. */
export function legKey(leg: BrokerOrderLeg): string {
  return `${leg.side}:${leg.contractSymbol}:${leg.quantity}`;
}
