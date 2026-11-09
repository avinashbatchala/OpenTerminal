export type Horizon = "intraday" | "swing";
export type Direction = "bullish" | "bearish" | "neutral";
export type OpportunityState = "watching" | "entry_ready" | "invalidated" | "expired" | "missed";
export type DataHealth = "current" | "stale" | "unable";
export type RecipeId =
  | "TREND-PULLBACK"
  | "RANGE-BREAKOUT"
  | "MEAN-REVERSION"
  | "VOLATILITY-RANGE"
  | "VOLATILITY-TREND-CREDIT";

export type ScannerLeg = {
  contractSymbol: string;
  underlying: string;
  expiry: string;
  optionType: "call" | "put";
  strike: number;
  side: "buy" | "sell";
  quantity: number;
  ratio: number;
  multiplier: number;
  bid: number | null;
  ask: number | null;
  quoteTime: string | null;
  source: string;
  deliverable: string | null;
  deliverableSource?: "provider" | "derived" | null;
};

export type RiskModel = {
  maxLossUsd: number;
  feesUsd: number;
  entryFeesUsd: number;
  exitFeesUsd: number;
  expiryFeesUsd: number;
  netDebitUsd: number | null;
  netCreditUsd: number | null;
  widthUsd: number | null;
  multiplier: number;
  contracts: number;
  slippageScenario: {
    label: string;
    netDebitUsd: number | null;
    netCreditUsd: number | null;
    modeledLossUsd: number;
    includedInRiskLimit: false;
  };
  assumptions: string[];
};

export type FrozenLevels = {
  entry: number | null;
  invalidation: number | null;
  target: number | null;
  chasePct: number | null;
  rangeLow: number | null;
  rangeHigh: number | null;
  shortPut: number | null;
  shortCall: number | null;
  minCreditPerShare: number | null;
  frozenCreditPerShare: number | null;
  targetCreditFraction: number | null;
};

export type Opportunity = {
  id: string;
  identityKey: string;
  muteKey: string;
  predecessorId: string | null;
  symbol: string;
  horizon: Horizon;
  strategy: string;
  direction: Direction;
  recipeId: RecipeId;
  recipeVersion: string;
  expiry: string;
  deadline: string;
  state: OpportunityState;
  dataHealth: DataHealth;
  currentHealth: DataHealth;
  pinned: boolean;
  dismissed: boolean;
  muted: boolean;
  archived: boolean;
  watchlistDecision: "monitor" | "archive" | "pending";
  configRevision: number;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
  legs: ScannerLeg[];
  risk: RiskModel;
  signal: {
    recipeId: RecipeId;
    recipeVersion: string;
    horizon: Horizon;
    direction: Direction;
    signalBarTime: string;
    features: Record<string, number | string | null>;
    barsUsed: number;
    source: string;
  };
  conditions: {
    entry: string;
    invalidation: string;
    target: string | null;
    deadline: string;
    levels: FrozenLevels;
  };
  thesis: string;
  earnings: { checked: boolean; nextEarningsDate: string | null };
  currentEvidence: Record<string, unknown> | null;
  aiStatus: "pending" | "ready" | "failed" | "unavailable";
};

export type OpportunityCheck = {
  id: number;
  opportunityId: string;
  checkedAt: string;
  health: DataHealth;
  stateBefore: OpportunityState;
  stateAfter: OpportunityState;
  evidence: Record<string, unknown>;
  note: string | null;
};

export type ScannerEvent = {
  id: number;
  opportunityId: string;
  type: string;
  dedupeKey: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type AiAssessment = {
  opportunityId: string;
  status: "ready" | "failed" | "unavailable";
  output: {
    summary: string;
    thesis: string;
    risks: string[];
    rank: number;
    confidence: "low" | "medium" | "high";
  } | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  estimatedCostUsd: number | null;
  pricingSource: string | null;
  error: string | null;
  createdAt: string;
};

export type RecipeParamDefinition = {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  description: string;
};

export type RecipeDefinition = {
  id: RecipeId;
  version: string;
  name: string;
  description: string;
  horizons: Horizon[];
  dataDependencies: string[];
  params: RecipeParamDefinition[];
};

export type RecipeConfig = {
  enabled: boolean;
  acceptedVersion: string | null;
  paramsApproved: boolean;
  params: Record<string, number>;
};

export type ScannerConfig = {
  enabled: boolean;
  revision: number;
  watchlist: string[];
  watchlistRevision: number;
  fees: {
    currency: "USD";
    perOrderUsd: number;
    entryPerContractUsd: number;
    exitPerContractUsd: number;
    expiryPerContractUsd: number;
    confirmed: boolean;
  };
  horizons: Record<Horizon, { minDays: number; maxDays: number; confirmed: boolean }>;
  quotes: {
    maxUnderlyingAgeSeconds: number;
    maxOptionAgeSeconds: number;
    maxLegSkewSeconds: number;
    maxBidAskWidthPct: number;
    minVolume: number;
    minOpenInterest: number;
    confirmed: boolean;
  };
  selection: {
    maxStrikesPerSide: number;
    targetStrikeDistancePct: number;
    maxStrikeDistancePct: number;
    minSpreadWidthPct: number;
    maxSpreadWidthPct: number;
    creditWingWidthPct: number;
    slippagePct: number;
    confirmed: boolean;
  };
  recipes: Record<RecipeId, RecipeConfig>;
  aiPricing: {
    source: string;
    inputPerMillionUsd: number;
    outputPerMillionUsd: number;
    cacheReadPerMillionUsd: number;
    cacheWritePerMillionUsd: number;
  } | null;
  historyAssumptionAccepted: boolean;
  maxWatchlistSymbols: number;
  scanIntervalMinutes: number;
  updatedAt: string | null;
};

export type ScannerStatus = {
  config: ScannerConfig;
  definitions: RecipeDefinition[];
  readiness: {
    ready: boolean;
    enabled: boolean;
    issues: string[];
    warnings: string[];
    recipes: Array<{
      id: RecipeId;
      version: string;
      enabled: boolean;
      accepted: boolean;
      ready: boolean;
      issues: string[];
      dataDependencies: string[];
    }>;
  };
  session: {
    state: "open" | "closed" | "unavailable";
    label: string;
    nextOpen: string | null;
    nextClose: string | null;
  };
  lastRun: {
    id: number;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    trigger: string;
    coverage: Array<{
      symbol: string;
      status: string;
      reason: string | null;
      recipes: Record<string, string>;
    }>;
    failures: string[];
    candidates: number;
    qualified: number;
    error: string | null;
  } | null;
  nextScheduledAt: string | null;
  monitoringGaps: string[];
  pendingWatchlistRemovals: Array<{ symbol: string; opportunityIds: string[] }>;
  unreadNotifications: number;
  aiUsage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number | null;
    unknownCostAssessments: number;
  };
};

export type ScannerNotification = {
  id: number;
  eventId: number;
  opportunityId: string;
  type: string;
  createdAt: string;
  readAt: string | null;
};

export const STRATEGY_LABELS: Record<string, string> = {
  long_call: "Long call",
  long_put: "Long put",
  debit_call_spread: "Call debit spread",
  debit_put_spread: "Put debit spread",
  bull_put_credit: "Bull put credit",
  bear_call_credit: "Bear call credit",
  iron_condor: "Iron condor",
};

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
}

export function legsSummary(opportunity: Pick<Opportunity, "legs">): string {
  return opportunity.legs
    .map(
      (leg) =>
        `${leg.side === "buy" ? "+" : "-"}${leg.quantity} ${leg.underlying} ${leg.expiry} ${leg.strike}${leg.optionType === "call" ? "C" : "P"}`
    )
    .join(" / ");
}

export function emptyState(
  status: ScannerStatus | undefined,
  opportunities: Opportunity[],
  filtered: boolean
): { title: string; detail: string } | null {
  if (!status) return null;
  if (!status.config.enabled) {
    return {
      title: "Scanner is paused",
      detail: "Review configuration and activate scanning before opportunities can be discovered.",
    };
  }
  if (!status.readiness.ready) {
    return {
      title: "Configuration required",
      detail: status.readiness.issues.slice(0, 3).join(" · "),
    };
  }
  if (status.session.state === "unavailable") {
    return {
      title: "Session calendar unavailable",
      detail: "Scanning eligibility cannot be verified.",
    };
  }
  if (status.session.state === "closed" && !status.lastRun) {
    return {
      title: "Market closed",
      detail: status.session.nextOpen
        ? `Next regular session opens ${formatDateTime(status.session.nextOpen)}.`
        : "No upcoming session was found.",
    };
  }
  if (!status.lastRun) {
    return {
      title: "Waiting for the first scan",
      detail:
        "The scanner is enabled but has not completed a scan yet. Results will appear after a verified regular-session run.",
    };
  }
  if (status.lastRun?.status === "failed") {
    return {
      title: "Last scan failed",
      detail: status.lastRun.error ?? "The scanner could not complete its last run.",
    };
  }
  if (status.lastRun?.status === "obsolete") {
    return {
      title: "Scan discarded",
      detail: "Configuration changed while the scan was running. A new scan will use the current revision.",
    };
  }
  if (status.lastRun?.status === "interrupted") {
    return {
      title: "Scan interrupted",
      detail: "The API process restarted during a scan. Monitoring gaps and deadlines were reconciled.",
    };
  }
  if (status.lastRun && status.lastRun.coverage.some((entry) => entry.status === "failed")) {
    return {
      title: "Incomplete coverage",
      detail: "Some symbols could not be assessed. See coverage details before treating this as an empty scan.",
    };
  }
  if (opportunities.length === 0) {
    return filtered
      ? { title: "No matches", detail: "No opportunities match the current filters." }
      : { title: "No qualifying opportunities", detail: "The latest completed checks produced no setups that passed every gate." };
  }
  return null;
}
