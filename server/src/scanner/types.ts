export const RECIPE_VERSION = "1.0.0";

export type RecipeId =
  | "TREND-PULLBACK"
  | "RANGE-BREAKOUT"
  | "MEAN-REVERSION"
  | "VOLATILITY-RANGE"
  | "VOLATILITY-TREND-CREDIT";

export type Horizon = "intraday" | "swing";
export type Direction = "bullish" | "bearish" | "neutral";
export type OpportunityState =
  | "watching"
  | "entry_ready"
  | "invalidated"
  | "expired"
  | "missed";
export type DataHealth = "current" | "stale" | "unable";
export type WatchlistDecision = "monitor" | "archive" | "pending";

export type Strategy =
  | "long_call"
  | "long_put"
  | "debit_call_spread"
  | "debit_put_spread"
  | "bull_put_credit"
  | "bear_call_credit"
  | "iron_condor";

export type OptionType = "call" | "put";
export type LegSide = "buy" | "sell";

export type ScannerLeg = {
  contractSymbol: string;
  underlying: string;
  expiry: string;
  optionType: OptionType;
  strike: number;
  side: LegSide;
  quantity: number;
  ratio: number;
  multiplier: number;
  bid: number | null;
  ask: number | null;
  quoteTime: string | null;
  source: string;
  deliverable: string | null;
  deliverableSource: "provider" | "derived" | null;
};

export type FeeAssumptions = {
  currency: "USD";
  perOrderUsd: number;
  entryPerContractUsd: number;
  exitPerContractUsd: number;
  expiryPerContractUsd: number;
  confirmed: boolean;
};

export type HorizonRange = {
  minDays: number;
  maxDays: number;
  confirmed: boolean;
};

export type QuoteLimits = {
  maxUnderlyingAgeSeconds: number;
  maxOptionAgeSeconds: number;
  maxLegSkewSeconds: number;
  maxBidAskWidthPct: number;
  minVolume: number;
  minOpenInterest: number;
  confirmed: boolean;
};

export type ContractSelectionConfig = {
  maxStrikesPerSide: number;
  targetStrikeDistancePct: number;
  maxStrikeDistancePct: number;
  minSpreadWidthPct: number;
  maxSpreadWidthPct: number;
  creditWingWidthPct: number;
  slippagePct: number;
  confirmed: boolean;
};

export type AiPricingConfig = {
  source: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cacheReadPerMillionUsd: number;
  cacheWritePerMillionUsd: number;
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
  fees: FeeAssumptions;
  horizons: Record<Horizon, HorizonRange>;
  quotes: QuoteLimits;
  selection: ContractSelectionConfig;
  recipes: Record<RecipeId, RecipeConfig>;
  aiPricing: AiPricingConfig | null;
  historyAssumptionAccepted: boolean;
  maxWatchlistSymbols: number;
  scanIntervalMinutes: number;
  updatedAt: string | null;
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

export type FrozenConditions = {
  entry: string;
  invalidation: string;
  target: string | null;
  deadline: string;
  levels: FrozenLevels;
};

export type SignalEvidence = {
  recipeId: RecipeId;
  recipeVersion: string;
  horizon: Horizon;
  direction: Direction;
  signalBarTime: string;
  features: Record<string, number | string | null>;
  barsUsed: number;
  source: string;
};

export type OpportunityCandidate = {
  identityKey: string;
  muteKey: string;
  symbol: string;
  horizon: Horizon;
  strategy: Strategy;
  direction: Direction;
  recipeId: RecipeId;
  recipeVersion: string;
  expiry: string;
  deadline: string;
  legs: ScannerLeg[];
  risk: RiskModel;
  signal: SignalEvidence;
  thesis: string;
  conditions: FrozenConditions;
  earnings: { checked: boolean; nextEarningsDate: string | null };
  dataHealth: DataHealth;
};

export type OpportunityRecord = OpportunityCandidate & {
  id: string;
  predecessorId: string | null;
  state: OpportunityState;
  pinned: boolean;
  dismissed: boolean;
  muted: boolean;
  archived: boolean;
  watchlistDecision: WatchlistDecision;
  configRevision: number;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
  currentHealth: DataHealth;
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
  type: "discovery" | "entry_ready" | "invalidated" | "target_observed" | "watchlist_removed_pending" | "missed";
  dedupeKey: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type ScannerNotification = {
  id: number;
  eventId: number;
  opportunityId: string;
  type: ScannerEvent["type"];
  createdAt: string;
  readAt: string | null;
};

export type AiAssessment = {
  opportunityId: string;
  candidateHash: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
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

export type ScanCoverage = {
  symbol: string;
  status: "scanned" | "held" | "excluded" | "failed";
  reason: string | null;
  recipes: Record<string, string>;
};

export type ScanRun = {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "failed" | "interrupted" | "obsolete" | "market_closed";
  trigger: "scheduled" | "recovery" | "manual";
  configRevision: number;
  coverage: ScanCoverage[];
  failures: string[];
  candidates: number;
  qualified: number;
  error: string | null;
};

export type ScannerStatus = {
  config: ScannerConfig;
  definitions: RecipeDefinition[];
  readiness: ScannerReadiness;
  session: {
    state: "open" | "closed" | "unavailable";
    label: string;
    nextOpen: string | null;
    nextClose: string | null;
  };
  lastRun: ScanRun | null;
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

export type ScannerReadiness = {
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
