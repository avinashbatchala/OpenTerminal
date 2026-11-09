import type { Opportunity } from "./scanner";

export type ExecutionTradeStatus =
  | "pending_entry"
  | "open"
  | "pending_exit"
  | "closed"
  | "rejected"
  | "cancelled";

export type ExitReason =
  | { kind: "invalidation"; state: "invalidated" | "missed" | "expired" }
  | { kind: "profit_target"; fraction: number; pnlUsd: number }
  | { kind: "stop_loss"; fraction: number; pnlUsd: number }
  | { kind: "deadline"; deadline: string }
  | { kind: "time_stop"; heldMs: number }
  | { kind: "manual"; actor: string };

export type ExecutionConfig = {
  enabled: boolean;
  startingCashUsd: number;
  automation: { entries: boolean; exits: boolean };
  exits: {
    profitTargetFraction: number;
    stopLossFraction: number;
    timeStopMinutes: number | null;
  };
  slippage: {
    spreadFactor: number;
    impactBps: number;
    jitterBps: number;
    maxSlippagePct: number;
  };
  quotes: { maxQuoteAgeMs: number; limitBufferPct: number };
  fees: { perOrderUsd: number; perContractUsd: number };
  limits: { maxOpenTrades: number; maxPerSymbol: number };
};

export type FillSummaryLeg = {
  contractSymbol: string;
  side: "buy" | "sell";
  quantity: number;
  multiplier: number;
  referenceMid: number;
  fillPrice: number;
  feesUsd: number;
  slippageUsd: number;
  at: string;
};

export type FillSummary = {
  legs: FillSummaryLeg[];
  feesUsd: number;
  slippageUsd: number;
  netPricePerShare: number;
  midPricePerShare: number;
  slippagePctOfMid: number;
  filledAt: string;
};

export type TradePnl = {
  grossUsd: number;
  feesUsd: number;
  netUsd: number;
  entryNetPerShare: number;
  exitNetPerShare: number;
  multiplier: number;
};

export type ExecutionTrade = {
  id: string;
  opportunityId: string;
  identityKey: string;
  symbol: string;
  horizon: string;
  strategy: string;
  status: ExecutionTradeStatus;
  setup: Opportunity;
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

export type ExecutionOrder = {
  clientOrderId: string;
  tradeId: string;
  intent: "entry" | "exit";
  brokerOrderId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionMark = {
  tradeId: string;
  markedAt: string;
  liquidationValueUsd: number;
  underlyingPrice: number | null;
};

export type ExecutionEvent = {
  id: number;
  tradeId: string | null;
  type: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type EquitySnapshot = {
  asOf: string;
  cashUsd: number;
  positionsUsd: number;
  equityUsd: number;
};

export type ExecutionLiveStatus = {
  streaming: boolean;
  source: "stream" | "poll" | null;
  lastMarkAt: string | null;
};

export type ExecutionStatus = {
  config: ExecutionConfig;
  counts: Record<ExecutionTradeStatus, number>;
  openTrades: ExecutionTrade[];
  latestMarks: Record<string, ExecutionMark | null>;
  equity: EquitySnapshot | null;
  live?: ExecutionLiveStatus;
  broker:
    | {
        ok: true;
        cashUsd: number;
        positions: Array<{
          contractSymbol: string;
          quantity: number;
          averagePrice: number;
          multiplier: number;
        }>;
      }
    | { ok: false; error: { kind: string; message: string } };
};

export type ExecutionDetail = {
  trade: ExecutionTrade;
  orders: ExecutionOrder[];
  fills: ExecutionFill[];
  marks: ExecutionMark[];
  events: ExecutionEvent[];
};

export type EquityPayload = {
  latest: EquitySnapshot | null;
  history: EquitySnapshot[];
};

export function entryPremiumUsd(trade: ExecutionTrade): number | null {
  const summary = trade.entrySummary;
  const multiplier = summary?.legs[0]?.multiplier;
  if (!summary || !multiplier) return null;
  return summary.netPricePerShare * multiplier;
}

export function unrealizedUsd(trade: ExecutionTrade, mark: ExecutionMark | null): number | null {
  const entry = entryPremiumUsd(trade);
  if (entry === null || !mark) return null;
  // Net of entry fees so open P&L and Realized P&L both reconcile to equity.
  return mark.liquidationValueUsd - entry - (trade.entrySummary?.feesUsd ?? 0);
}

/** Day change from the first equity snapshot of the current local day. */
export function dayChangeUsd(history: readonly EquitySnapshot[]): number | null {
  if (history.length === 0) return null;
  const latest = history[0];
  const latestDay = new Date(latest.asOf).toDateString();
  const first = [...history].reverse().find((row) => new Date(row.asOf).toDateString() === latestDay);
  if (!first) return null;
  return latest.equityUsd - first.equityUsd;
}
