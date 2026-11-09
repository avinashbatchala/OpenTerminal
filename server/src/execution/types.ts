import type { OpportunityRecord } from "../scanner/types.js";
import type { Result } from "./ports/broker.js";
import type { BrokerOrderRequest, BrokerError, BrokerPosition } from "./ports/broker.js";
import type { ExecutionConfig } from "./config.js";
import type { OrderState } from "./domain/order.js";
import type { FillSummary } from "./domain/fill.js";
import type { TradePnl } from "./domain/pnl.js";

export type ExecutionTradeStatus =
  | "pending_entry"
  | "open"
  | "pending_exit"
  | "closed"
  | "rejected"
  | "cancelled";

export type ExecutionIntent = "entry" | "exit";

export type ExecutionTrade = {
  id: string;
  opportunityId: string;
  identityKey: string;
  symbol: string;
  horizon: string;
  strategy: string;
  status: ExecutionTradeStatus;
  setup: OpportunityRecord;
  entryOrderId: string | null;
  exitOrderId: string | null;
  entrySummary: FillSummary | null;
  exitSummary: FillSummary | null;
  pnl: TradePnl | null;
  createdAt: string;
  updatedAt: string;
  openedAt: string | null;
  closedAt: string | null;
};

export type ExecutionOrder = {
  clientOrderId: string;
  tradeId: string;
  intent: ExecutionIntent;
  brokerOrderId: string | null;
  status: OrderState["status"];
  request: BrokerOrderRequest;
  state: OrderState;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionFill = {
  fillId: string;
  clientOrderId: string;
  tradeId: string;
  contractSymbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  referenceMid: number;
  multiplier: number;
  slippageUsd: number;
  feesUsd: number;
  filledAt: string;
};

export type ExecutionEvent = {
  id: number;
  tradeId: string | null;
  type: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ExecutionError =
  | { kind: "not_found"; message: string }
  | { kind: "setup_not_ready"; state: string; message: string }
  | { kind: "already_traded"; tradeId: string; message: string }
  | { kind: "busy"; message: string }
  | { kind: "market_data"; message: string }
  | { kind: "broker"; error: BrokerError }
  | { kind: "invalid_state"; message: string }
  | { kind: "internal"; message: string };

export type ExecutionResult<T> = Result<T, ExecutionError>;

export type SetupSource = {
  find(opportunityId: string): OpportunityRecord | null;
};

export type ExecutionStatus = {
  config: ExecutionConfig;
  counts: Record<ExecutionTradeStatus, number>;
  openTrades: ExecutionTrade[];
  broker:
    | { ok: true; cashUsd: number; positions: readonly BrokerPosition[] }
    | { ok: false; error: BrokerError };
};
