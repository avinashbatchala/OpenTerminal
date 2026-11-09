/**
 * Execution boundary. The engine talks to this port only; paper is an adapter
 * today and a live broker will be another adapter tomorrow. Nothing below this
 * file may know how a fill was produced.
 */

export type Brand<T, B extends string> = T & { readonly __brand: B };
export type ClientOrderId = Brand<string, "ClientOrderId">;
export type BrokerOrderId = Brand<string, "BrokerOrderId">;
export type FillId = Brand<string, "FillId">;

function nonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} must not be empty`);
  return trimmed;
}

export function asClientOrderId(value: string): ClientOrderId {
  return nonEmpty(value, "clientOrderId") as ClientOrderId;
}

export function asBrokerOrderId(value: string): BrokerOrderId {
  return nonEmpty(value, "brokerOrderId") as BrokerOrderId;
}

export function asFillId(value: string): FillId {
  return nonEmpty(value, "fillId") as FillId;
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export type BrokerError =
  | { kind: "auth"; message: string }
  | { kind: "rate_limit"; message: string; retryAfterMs: number | null }
  | { kind: "rejected"; message: string; code: string | null }
  | { kind: "insufficient_funds"; message: string }
  | { kind: "unsupported_order"; message: string }
  | { kind: "network"; message: string; retryable: boolean }
  | { kind: "unknown"; message: string };

export type BrokerCapabilities = {
  assetClasses: readonly ("option" | "equity")[];
  supportsMultiLeg: boolean;
  supportsPartialFills: boolean;
  supportsCancel: boolean;
  orderTypes: readonly ("market" | "limit")[];
  fillDelivery: "push" | "poll";
};

export type BrokerOrderLeg = {
  contractSymbol: string;
  side: "buy" | "sell";
  quantity: number;
};

export type BrokerOrderRequest = {
  clientOrderId: ClientOrderId;
  intent: "open" | "close";
  assetClass: "option" | "equity";
  legs: readonly BrokerOrderLeg[];
  orderType: "market" | "limit";
  /** Net package price per share, or null for market orders. */
  netLimitPrice: number | null;
  timeInForce: "day" | "ioc";
};

export type BrokerFill = {
  fillId: FillId;
  contractSymbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  multiplier: number;
  feesUsd: number;
  at: string;
};

export type BrokerOrderUpdate =
  | { kind: "acknowledged"; brokerOrderId: BrokerOrderId; at: string }
  | {
      kind: "fill";
      brokerOrderId: BrokerOrderId;
      fills: readonly BrokerFill[];
      at: string;
    }
  | {
      kind: "rejected";
      brokerOrderId: BrokerOrderId | null;
      error: BrokerError;
      at: string;
    }
  | { kind: "cancelled"; brokerOrderId: BrokerOrderId; at: string }
  | { kind: "expired"; brokerOrderId: BrokerOrderId; at: string };

export type BrokerPosition = {
  contractSymbol: string;
  quantity: number;
  averagePrice: number;
  multiplier: number;
};

export type BrokerOpenOrder = {
  clientOrderId: ClientOrderId;
  brokerOrderId: BrokerOrderId;
  status: string;
};

export type BrokerSnapshot = {
  asOf: string;
  cashUsd: number;
  positions: readonly BrokerPosition[];
  openOrders: readonly BrokerOpenOrder[];
};

export interface BrokerPort {
  capabilities(): BrokerCapabilities;
  submit(
    request: BrokerOrderRequest
  ): Promise<Result<{ brokerOrderId: BrokerOrderId }, BrokerError>>;
  cancel(brokerOrderId: BrokerOrderId): Promise<Result<void, BrokerError>>;
  subscribe(onUpdate: (update: BrokerOrderUpdate) => void): () => void;
  snapshot(): Promise<Result<BrokerSnapshot, BrokerError>>;
}
