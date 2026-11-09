import { mapWithConcurrency } from "../concurrency.js";
import { getSettings } from "../settings.js";
import { scannerReadiness } from "./config.js";
import { isRegularSessionOpen, sessionState, setupDeadline } from "./calendar.js";
import { buildCandidates, selectExpiryForHorizon } from "./contracts.js";
import { assessCandidate, scannerCandidateHash, type ScannerAiClient } from "./ai.js";
import type { ScannerMarketData, NormalizedChain, NormalizedHistory, NormalizedQuote, EarningsMap } from "./market.js";
import { RECIPES } from "./recipes.js";
import { evaluateSignals } from "./signals.js";
import type { ScannerStore, CheckInput, IvObservation } from "./store.js";
import type {
  AiAssessment,
  Horizon,
  OpportunityCandidate,
  OpportunityRecord,
  OpportunityState,
  RecipeId,
  ScanCoverage,
  ScanRun,
  ScannerConfig,
} from "./types.js";

export type ScanOutcome = {
  status:
    | "disabled"
    | "configuration"
    | "market_closed"
    | "overlap"
    | "completed"
    | "failed"
    | "obsolete";
  runId?: number;
  error?: string;
  candidates?: number;
  qualified?: number;
};

export type MonitoringOutcome = {
  status: "disabled" | "configuration" | "market_closed" | "overlap" | "completed";
  checks?: number;
};

/** Minimum gap between routine (no-change) checks during the fast pass. */
const ROUTINE_CHECK_MS = 5 * 60_000;

function checkDue(opportunity: OpportunityRecord, now: Date): boolean {
  const last = Date.parse(opportunity.lastCheckedAt ?? opportunity.createdAt);
  return !Number.isFinite(last) || now.getTime() - last >= ROUTINE_CHECK_MS;
}

export type ScannerEngineOptions = {
  store: ScannerStore;
  market: ScannerMarketData;
  now?: () => Date;
  assess?: (candidate: OpportunityCandidate, options: { config: ScannerConfig }) => Promise<AiAssessment>;
  aiClient?: ScannerAiClient;
  logger?: (message: string) => void;
  maxSymbols?: number;
  maxAiAssessments?: number;
};

type DiscoveryResult = {
  coverage: ScanCoverage[];
  discoveries: OpportunityCandidate[];
  observations: IvObservation[];
  failures: string[];
  candidates: number;
};

type Cached<T> = Map<string, Promise<T>>;

function cached<T>(cache: Cached<T>, key: string, run: () => Promise<T>): Promise<T> {
  const existing = cache.get(key);
  if (existing) return existing;
  const promise = run();
  cache.set(key, promise);
  return promise;
}

function splitHorizonKey(key: string): { horizon: Horizon; recipeId: RecipeId } | null {
  const [horizon, recipeId] = key.split(":");
  if ((horizon !== "intraday" && horizon !== "swing") || !(recipeId in RECIPES)) return null;
  return { horizon, recipeId: recipeId as RecipeId };
}

function atmObservation(
  chain: NormalizedChain,
  symbol: string,
  spot: number,
  now: Date
): IvObservation | null {
  const nearest = (rows: typeof chain.calls) =>
    [...rows].sort(
      (a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot) || a.contractSymbol.localeCompare(b.contractSymbol)
    )[0] ?? null;
  const call = nearest(chain.calls);
  const put = nearest(chain.puts);
  const ivs = [call?.impliedVolatility, put?.impliedVolatility].filter(
    (value): value is number => typeof value === "number" && value > 0
  );
  if (ivs.length === 0) return null;
  const expiry = chain.selectedDate ?? chain.requestedExpiry;
  const tenorDays = Math.round(
    (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)) /
      86_400_000
  );
  return {
    symbol,
    tenorDays,
    moneyness: "ATM",
    observedAt: now.toISOString(),
    iv: ivs.reduce((sum, value) => sum + value, 0) / ivs.length,
    source: chain.calls[0]?.source ?? chain.puts[0]?.source ?? chain.source,
  };
}

function quoteHealth(
  quote: NormalizedQuote,
  config: ScannerConfig,
  now: Date
): { health: "current" | "stale" | "unable"; reason: string | null } {
  if (quote.price === null || quote.price <= 0) return { health: "unable", reason: "Underlying price is unavailable" };
  if (!quote.quoteTime) return { health: "unable", reason: "Underlying quote timestamp is unavailable" };
  const age = (now.getTime() - Date.parse(quote.quoteTime)) / 1000;
  if (!Number.isFinite(age)) return { health: "unable", reason: "Underlying quote timestamp is unreadable" };
  if (age > config.quotes.maxUnderlyingAgeSeconds) {
    return { health: "stale", reason: `Underlying quote age ${Math.round(age)}s exceeds the configured limit` };
  }
  return { health: "current", reason: null };
}

function chainForLegs(
  chain: NormalizedChain,
  opportunity: OpportunityRecord
): { map: Map<string, NormalizedChain["calls"][number]>; reason: string | null } {
  if (chain.issues.length) return { map: new Map(), reason: chain.issues.join("; ") };
  const map = new Map(
    [...chain.calls, ...chain.puts].map((option) => [option.contractSymbol, option])
  );
  const missing = opportunity.legs.filter((leg) => !map.has(leg.contractSymbol));
  if (missing.length) {
    return {
      map,
      reason: `Missing current quote for ${missing.map((leg) => leg.contractSymbol).join(", ")}`,
    };
  }
  return { map, reason: null };
}

function optionHealth(
  opportunity: OpportunityRecord,
  chain: NormalizedChain,
  config: ScannerConfig,
  now: Date
): { health: "current" | "stale" | "unable"; reason: string | null } {
  const { map, reason } = chainForLegs(chain, opportunity);
  if (reason) return { health: "unable", reason };
  const times: number[] = [];
  for (const leg of opportunity.legs) {
    const current = map.get(leg.contractSymbol);
    if (!current || current.bid === null || current.ask === null || current.bid < 0 || current.ask <= 0) {
      return { health: "unable", reason: `Leg quote is missing for ${leg.contractSymbol}` };
    }
    if (current.bid > current.ask) {
      return { health: "unable", reason: `Crossed market for ${leg.contractSymbol}` };
    }
    if (!current.quoteTime) {
      return { health: "unable", reason: `Leg quote timestamp is missing for ${leg.contractSymbol}` };
    }
    const time = Date.parse(current.quoteTime);
    if (!Number.isFinite(time)) {
      return { health: "unable", reason: `Leg quote timestamp is unreadable for ${leg.contractSymbol}` };
    }
    times.push(time);
    const age = (now.getTime() - time) / 1000;
    if (age > config.quotes.maxOptionAgeSeconds) {
      return { health: "stale", reason: `Leg quote age ${Math.round(age)}s exceeds the configured limit` };
    }
  }
  if (times.length && (Math.max(...times) - Math.min(...times)) / 1000 > config.quotes.maxLegSkewSeconds) {
    return { health: "stale", reason: "Inter-leg quote skew exceeds the configured limit" };
  }
  return { health: "current", reason: null };
}

function packageCredit(
  opportunity: OpportunityRecord,
  chain: NormalizedChain
): number | null {
  const map = new Map([...chain.calls, ...chain.puts].map((option) => [option.contractSymbol, option]));
  let credit = 0;
  for (const leg of opportunity.legs) {
    const current = map.get(leg.contractSymbol);
    if (!current || current.bid === null || current.ask === null) return null;
    credit += leg.side === "sell" ? current.bid : -current.ask;
  }
  return credit;
}

function currentClosingDebit(
  opportunity: OpportunityRecord,
  chain: NormalizedChain
): number | null {
  const credit = packageCredit(opportunity, chain);
  return credit === null ? null : -credit;
}

const CREDIT_STRATEGIES = new Set(["iron_condor", "bull_put_credit", "bear_call_credit"]);

type PriceTransition = {
  state: OpportunityState;
  events: CheckInput["events"];
  note: string | null;
};

function chaseBand(
  opportunity: OpportunityRecord,
  price: number
): { inBand: boolean; beyond: boolean; distancePct: number | null } {
  const { entry, chasePct } = opportunity.conditions.levels;
  if (entry === null || !Number.isFinite(entry) || entry <= 0) {
    return { inBand: false, beyond: false, distancePct: null };
  }
  const chase = Math.max(0, chasePct ?? 0) / 100;
  const distancePct = ((price - entry) / entry) * 100;
  if (opportunity.direction === "bullish") {
    return {
      inBand: price >= entry && price <= entry * (1 + chase),
      beyond: price > entry * (1 + chase),
      distancePct,
    };
  }
  return {
    inBand: price <= entry && price >= entry * (1 - chase),
    beyond: price < entry * (1 - chase),
    distancePct,
  };
}

/**
 * Transitions that need only the underlying price, so they can run on a short
 * cadence without fetching an option chain. Entry readiness still requires a
 * verified chain and is intentionally excluded.
 */
function priceOnlyTransition(opportunity: OpportunityRecord, price: number): PriceTransition {
  const unchanged: PriceTransition = { state: opportunity.state, events: [], note: null };
  if (opportunity.state === "invalidated" || opportunity.state === "expired" || opportunity.state === "missed") {
    return unchanged;
  }
  const levels = opportunity.conditions.levels;

  if (CREDIT_STRATEGIES.has(opportunity.strategy)) {
    const shortPut = levels.shortPut;
    const shortCall = levels.shortCall;
    const invalidated =
      (shortPut !== null && price <= shortPut) || (shortCall !== null && price >= shortCall);
    if (!invalidated) return unchanged;
    return {
      state: "invalidated",
      events: [
        {
          type: "invalidated",
          dedupeKey: `invalidated:${opportunity.id}`,
          payload: { price, shortPut, shortCall },
          notify: true,
        },
      ],
      note: "Underlying crossed a frozen short strike",
    };
  }

  if (levels.entry === null || levels.invalidation === null) return unchanged;
  const bullish = opportunity.direction === "bullish";
  const invalidated = bullish ? price <= levels.invalidation : price >= levels.invalidation;
  if (invalidated) {
    return {
      state: "invalidated",
      events: [
        {
          type: "invalidated",
          dedupeKey: `invalidated:${opportunity.id}`,
          payload: { price, invalidation: levels.invalidation },
          notify: true,
        },
      ],
      note: "Frozen invalidation level crossed",
    };
  }

  if (opportunity.state === "watching") {
    const band = chaseBand(opportunity, price);
    if (band.beyond && band.distancePct !== null) {
      return {
        state: "missed",
        events: [
          {
            type: "missed",
            dedupeKey: `missed:${opportunity.id}`,
            payload: {
              price,
              entry: levels.entry,
              chasePct: levels.chasePct,
              distancePct: band.distancePct,
            },
            notify: true,
          },
        ],
        note: `Entry missed: price moved ${Math.abs(band.distancePct).toFixed(2)}% beyond the ${
          levels.chasePct ?? 0
        }% chase limit`,
      };
    }
  }

  return unchanged;
}

function directionalState(
  opportunity: OpportunityRecord,
  price: number,
  nowIso: string
): { state: OpportunityState; events: CheckInput["events"]; ambiguous: boolean; note: string | null } {
  const levels = opportunity.conditions.levels;
  if (levels.entry === null || levels.invalidation === null) {
    return { state: opportunity.state, events: [], ambiguous: true, note: "Frozen levels are incomplete" };
  }
  const bullish = opportunity.direction === "bullish";
  const invalidated = bullish ? price <= levels.invalidation : price >= levels.invalidation;
  const chase = levels.chasePct ?? 0;
  const band = chaseBand(opportunity, price);
  const entered = band.inBand;
  if (invalidated && entered) {
    return {
      state: opportunity.state,
      events: [],
      ambiguous: true,
      note: "Entry and invalidation conditions were observed in the same check; no transition was inferred",
    };
  }
  if (invalidated) {
    return {
      state: "invalidated",
      events: [
        {
          type: "invalidated",
          dedupeKey: `invalidated:${opportunity.id}`,
          payload: { price, invalidation: levels.invalidation },
          notify: true,
        },
      ],
      ambiguous: false,
      note: null,
    };
  }
  if (opportunity.state === "watching" && band.beyond && band.distancePct !== null) {
    return {
      state: "missed",
      events: [
        {
          type: "missed",
          dedupeKey: `missed:${opportunity.id}`,
          payload: {
            price,
            entry: levels.entry,
            chasePct: levels.chasePct,
            distancePct: band.distancePct,
          },
          notify: true,
        },
      ],
      ambiguous: false,
      note: `Entry missed: price moved ${Math.abs(band.distancePct).toFixed(2)}% beyond the ${chase}% chase limit`,
    };
  }
  if (opportunity.state === "watching" && entered) {
    return {
      state: "entry_ready",
      events: [
        {
          type: "entry_ready",
          dedupeKey: `entry:${opportunity.id}:${levels.entry}`,
          payload: { price, entry: levels.entry },
          notify: true,
        },
      ],
      ambiguous: false,
      note: null,
    };
  }
  if (
    opportunity.state === "entry_ready" &&
    levels.target !== null &&
    (bullish ? price >= levels.target : price <= levels.target)
  ) {
    return {
      state: "entry_ready",
      events: [
        {
          type: "target_observed",
          dedupeKey: `target:${opportunity.id}:${levels.target}`,
          payload: { price, target: levels.target, hypothetical: true },
          notify: false,
        },
      ],
      ambiguous: false,
      note: "Target observation is not a fill or realized return",
    };
  }
  return { state: opportunity.state, events: [], ambiguous: false, note: null };
}

function creditState(
  opportunity: OpportunityRecord,
  price: number,
  chain: NormalizedChain,
  nowIso: string
): { state: OpportunityState; events: CheckInput["events"]; ambiguous: boolean; note: string | null } {
  const levels = opportunity.conditions.levels;
  const credit = packageCredit(opportunity, chain);
  if (credit === null) {
    return { state: opportunity.state, events: [], ambiguous: true, note: "Package quotes are incomplete" };
  }
  const shortPut = levels.shortPut;
  const shortCall = levels.shortCall;
  const invalidated =
    (shortPut !== null && price <= shortPut) || (shortCall !== null && price >= shortCall);
  const entryMinimum = levels.minCreditPerShare ?? 0;
  const entered =
    credit >= entryMinimum &&
    (opportunity.strategy !== "iron_condor" ||
      (levels.rangeLow !== null && levels.rangeHigh !== null && price >= levels.rangeLow && price <= levels.rangeHigh));
  if (invalidated && entered) {
    return {
      state: opportunity.state,
      events: [],
      ambiguous: true,
      note: "Entry and invalidation conditions were observed in the same check; no transition was inferred",
    };
  }
  if (invalidated) {
    return {
      state: "invalidated",
      events: [
        {
          type: "invalidated",
          dedupeKey: `invalidated:${opportunity.id}`,
          payload: { price, shortPut, shortCall },
          notify: true,
        },
      ],
      ambiguous: false,
      note: null,
    };
  }
  if (opportunity.state === "watching" && entered) {
    return {
      state: "entry_ready",
      events: [
        {
          type: "entry_ready",
          dedupeKey: `entry:${opportunity.id}:credit`,
          payload: { price, credit, minimum: entryMinimum },
          notify: true,
        },
      ],
      ambiguous: false,
      note: null,
    };
  }
  const targetFraction = levels.targetCreditFraction;
  const frozenCredit = levels.frozenCreditPerShare;
  if (
    opportunity.state === "entry_ready" &&
    targetFraction !== null &&
    frozenCredit !== null
  ) {
    const debit = currentClosingDebit(opportunity, chain);
    if (debit !== null && debit <= frozenCredit * targetFraction) {
      return {
        state: "entry_ready",
        events: [
          {
            type: "target_observed",
            dedupeKey: `target:${opportunity.id}:credit:${frozenCredit * targetFraction}`,
            payload: { closingDebit: debit, targetDebit: frozenCredit * targetFraction, hypothetical: true },
            notify: false,
          },
        ],
        ambiguous: false,
        note: "Package repricing target is hypothetical and is not a fill or realized return",
      };
    }
  }
  return { state: opportunity.state, events: [], ambiguous: false, note: null };
}

export class ScannerEngine {
  private readonly store: ScannerStore;
  private readonly market: ScannerMarketData;
  private readonly now: () => Date;
  private readonly assess: NonNullable<ScannerEngineOptions["assess"]>;
  private readonly logger: (message: string) => void;
  private readonly maxSymbols: number;
  private readonly maxAiAssessments: number;

  constructor(options: ScannerEngineOptions) {
    this.store = options.store;
    this.market = options.market;
    this.now = options.now ?? (() => new Date());
    this.assess =
      options.assess ??
      ((candidate, { config }) => assessCandidate(candidate, { client: options.aiClient, config }));
    this.logger = options.logger ?? ((message) => console.warn(`[scanner] ${message}`));
    this.maxSymbols = options.maxSymbols ?? 25;
    this.maxAiAssessments = options.maxAiAssessments ?? 5;
  }

  expireDeadlines(now = this.now()): number {
    const active = this.store.listActiveOpportunities();
    let expired = 0;
    for (const opportunity of active) {
      if (Date.parse(opportunity.deadline) > now.getTime()) continue;
      this.store.appendCheck({
        opportunityId: opportunity.id,
        checkedAt: now.toISOString(),
        health: "current",
        stateBefore: opportunity.state,
        stateAfter: "expired",
        evidence: {
          reason: "Deadline passed",
          deadline: opportunity.deadline,
          note: "Expiry is terminal; no intermediate market events were invented.",
        },
        note: "Expired at frozen deadline",
        events: [],
      });
      expired += 1;
    }
    return expired;
  }

  recoverAfterRestart(): { interrupted: number; expired: number } {
    const interrupted = this.store.recoverInterruptedRuns();
    const expired = this.expireDeadlines();
    return { interrupted, expired };
  }

  private async discovery(
    config: ScannerConfig,
    now: Date,
    quotes: Cached<NormalizedQuote>,
    histories: Cached<NormalizedHistory>,
    expirationLists: Cached<string[]>,
    chains: Cached<NormalizedChain>
  ): Promise<DiscoveryResult> {
    const watchlist = config.watchlist.slice(0, Math.min(config.maxWatchlistSymbols, this.maxSymbols));
    const coverage: ScanCoverage[] = [];
    const discoveries: OpportunityCandidate[] = [];
    const observations: IvObservation[] = [];
    const failures: string[] = [];
    let candidates = 0;

    let earnings: EarningsMap = {};
    let earningsError: string | null = null;
    try {
      earnings = await this.market.earnings(watchlist);
    } catch (error) {
      earningsError = error instanceof Error ? error.message : String(error);
      failures.push(`Earnings coverage failed: ${earningsError}`);
    }

    const neededHorizons = new Set<Horizon>();
    for (const id of Object.keys(config.recipes) as RecipeId[]) {
      const recipe = config.recipes[id];
      if (!recipe.enabled) continue;
      for (const horizon of RECIPES[id].horizons) neededHorizons.add(horizon);
    }

    const results = await mapWithConcurrency(watchlist, 2, async (symbol) => {
      const recipeStatus: Record<string, string> = {};
      const addCandidate = (candidate: OpportunityCandidate) => discoveries.push(candidate);
      let quote: NormalizedQuote;
      try {
        quote = await cached(quotes, symbol, () => this.market.quote(symbol));
      } catch (error) {
        return {
          symbol,
          status: "failed" as const,
          reason: `Quote failed: ${error instanceof Error ? error.message : String(error)}`,
          recipes: recipeStatus,
        };
      }
      const spot = quote.price;
      if (spot === null || spot <= 0) {
        return {
          symbol,
          status: "held" as const,
          reason: "Underlying price is unavailable",
          recipes: recipeStatus,
        };
      }

      let expirations: string[] = [];
      try {
        expirations = await cached(expirationLists, symbol, () => this.market.expirations(symbol));
      } catch (error) {
        const reason = `Option expirations failed: ${error instanceof Error ? error.message : String(error)}`;
        failures.push(`${symbol}: ${reason}`);
        return { symbol, status: "held" as const, reason, recipes: recipeStatus };
      }

      const historyByHorizon = new Map<Horizon, NormalizedHistory>();
      for (const horizon of neededHorizons) {
        try {
          historyByHorizon.set(
            horizon,
            await cached(histories, `${symbol}:${horizon}`, () => this.market.history(symbol, horizon))
          );
        } catch (error) {
          failures.push(
            `${symbol} ${horizon} history: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      const chainForExpiry = async (expiry: string) => {
        const chain = await cached(chains, `${symbol}:${expiry}`, () => this.market.chain(symbol, expiry));
        const observation = atmObservation(chain, symbol, spot, now);
        if (observation) observations.push(observation);
        return chain;
      };

      for (const id of Object.keys(config.recipes) as RecipeId[]) {
        const recipe = config.recipes[id];
        if (!recipe.enabled) continue;
        const definition = RECIPES[id];
        for (const horizon of definition.horizons) {
          const key = `${horizon}:${id}`;
          const history = historyByHorizon.get(horizon);
          if (!history) {
            recipeStatus[key] = "held: history unavailable";
            continue;
          }
          if (history.issues.length) {
            recipeStatus[key] = `held: ${history.issues.join("; ")}`;
            continue;
          }
          const ivSummary = ["VOLATILITY-RANGE", "VOLATILITY-TREND-CREDIT"].includes(id)
            ? this.store.ivSummary(
                symbol,
                recipe.params.ivLookbackDays,
                recipe.params.ivTenorMinDays,
                recipe.params.ivTenorMaxDays
              )
            : null;
          if (ivSummary) {
            const latestAgeHours = ivSummary.latestAt
              ? (now.getTime() - Date.parse(ivSummary.latestAt)) / 3_600_000
              : Number.POSITIVE_INFINITY;
            const ivReady =
              ivSummary.days >= recipe.params.ivMinDays &&
              ivSummary.percentile !== null &&
              ivSummary.percentile >= recipe.params.ivPercentile &&
              latestAgeHours <= recipe.params.ivMaxAgeHours;
            if (!ivReady) {
              const expiry = selectExpiryForHorizon(expirations, horizon, config, now).expiry;
              if (expiry) {
                try {
                  await chainForExpiry(expiry);
                } catch (error) {
                  failures.push(
                    `${symbol} IV observation: ${error instanceof Error ? error.message : String(error)}`
                  );
                }
              }
              recipeStatus[key] = `warming up: IV history ${ivSummary.days}/${recipe.params.ivMinDays} days, percentile ${
                ivSummary.percentile === null ? "unavailable" : ivSummary.percentile.toFixed(0)
              }`;
              continue;
            }
          }
          const evaluation = evaluateSignals(id, horizon, history.bars, recipe.params);
          if (evaluation.signals.length === 0) {
            recipeStatus[key] = `no signal: ${evaluation.issues.join("; ")}`;
            continue;
          }
          let qualified = 0;
          for (const signal of evaluation.signals) {
            const expirySelection = selectExpiryForHorizon(expirations, horizon, config, now);
            if (!expirySelection.expiry) {
              recipeStatus[key] = `held: ${expirySelection.issues.join("; ")}`;
              continue;
            }
            const expiry = expirySelection.expiry;
            const deadline = setupDeadline(horizon, expiry, now);
            if (Date.parse(deadline) <= now.getTime()) {
              recipeStatus[key] = "held: setup deadline already passed";
              continue;
            }
            const earningsState = earnings[symbol];
            if (earningsError || !earningsState) {
              recipeStatus[key] = "held: earnings coverage unavailable";
              continue;
            }
            if (
              earningsState.nextEarningsDate &&
              Date.parse(earningsState.nextEarningsDate) <= Date.parse(deadline)
            ) {
              recipeStatus[key] = `excluded: earnings ${earningsState.nextEarningsDate.slice(0, 10)} before deadline`;
              continue;
            }
            try {
              const chain = await chainForExpiry(expiry);
              const built = buildCandidates(
                signal,
                symbol,
                quote,
                chain,
                expiry,
                config,
                now,
                deadline,
                { checked: true, nextEarningsDate: earningsState.nextEarningsDate }
              );
              if (built.candidates.length) {
                for (const candidate of built.candidates) addCandidate(candidate);
                qualified += built.candidates.length;
              } else {
                recipeStatus[key] = `held: ${built.issues.join("; ")}`;
              }
            } catch (error) {
              recipeStatus[key] = `held: ${error instanceof Error ? error.message : String(error)}`;
            }
          }
          if (qualified > 0) recipeStatus[key] = `qualified: ${qualified}`;
          candidates += qualified;
        }
      }

      return {
        symbol,
        status: "scanned" as const,
        reason: null,
        recipes: recipeStatus,
      };
    });

    coverage.push(...results);
    return { coverage, discoveries, observations, failures, candidates };
  }

  private async monitoring(
    config: ScannerConfig,
    now: Date,
    quotes: Cached<NormalizedQuote>,
    chains: Cached<NormalizedChain>
  ): Promise<{ checks: CheckInput[]; failures: string[] }> {
    const active = this.store.listActiveOpportunities();
    const checks: CheckInput[] = [];
    const failures: string[] = [];
    for (const opportunity of active) {
      if (Date.parse(opportunity.deadline) <= now.getTime()) {
        checks.push({
          opportunityId: opportunity.id,
          checkedAt: now.toISOString(),
          health: "current",
          stateBefore: opportunity.state,
          stateAfter: "expired",
          evidence: { reason: "Deadline passed", deadline: opportunity.deadline },
          note: "Expired at frozen deadline",
          events: [],
        });
        continue;
      }
      try {
        const quote = await cached(quotes, opportunity.symbol, () =>
          this.market.quote(opportunity.symbol)
        );
        const qHealth = quoteHealth(quote, config, now);
        if (qHealth.health !== "current") {
          checks.push({
            opportunityId: opportunity.id,
            checkedAt: now.toISOString(),
            health: qHealth.health,
            stateBefore: opportunity.state,
            stateAfter: opportunity.state,
            evidence: { reason: qHealth.reason, quote },
            note: qHealth.reason,
            events: [],
          });
          continue;
        }
        if (quote.price === null) {
          checks.push({
            opportunityId: opportunity.id,
            checkedAt: now.toISOString(),
            health: "unable",
            stateBefore: opportunity.state,
            stateAfter: opportunity.state,
            evidence: { reason: "Underlying price is unavailable" },
            note: "Unable to assess",
            events: [],
          });
          continue;
        }
        // Terminal price transitions do not depend on option quotes, so they
        // are applied before the chain fetch and cannot be blocked by stale legs.
        const priceOnly = priceOnlyTransition(opportunity, quote.price);
        if (priceOnly.state !== opportunity.state) {
          checks.push({
            opportunityId: opportunity.id,
            checkedAt: now.toISOString(),
            health: "current",
            stateBefore: opportunity.state,
            stateAfter: priceOnly.state,
            evidence: {
              price: quote.price,
              quoteTime: quote.quoteTime,
              quoteSource: quote.source,
              note: priceOnly.note,
            },
            note: priceOnly.note,
            events: priceOnly.events,
          });
          continue;
        }
        const chain = await cached(chains, `${opportunity.symbol}:${opportunity.expiry}`, () =>
          this.market.chain(opportunity.symbol, opportunity.expiry)
        );
        const oHealth = optionHealth(opportunity, chain, config, now);
        if (oHealth.health !== "current") {
          checks.push({
            opportunityId: opportunity.id,
            checkedAt: now.toISOString(),
            health: oHealth.health,
            stateBefore: opportunity.state,
            stateAfter: opportunity.state,
            evidence: { reason: oHealth.reason, retrievedAt: chain.retrievedAt },
            note: oHealth.reason,
            events: [],
          });
          continue;
        }
        const transition = CREDIT_STRATEGIES.has(opportunity.strategy)
          ? creditState(opportunity, quote.price, chain, now.toISOString())
          : directionalState(opportunity, quote.price, now.toISOString());
        const health = transition.ambiguous ? "unable" : "current";
        checks.push({
          opportunityId: opportunity.id,
          checkedAt: now.toISOString(),
          health,
          stateBefore: opportunity.state,
          stateAfter: transition.state,
          evidence: {
            price: quote.price,
            quoteTime: quote.quoteTime,
            quoteSource: quote.source,
            optionRetrievedAt: chain.retrievedAt,
            packageCredit: packageCredit(opportunity, chain),
            note: transition.note,
          },
          note: transition.note,
          events: transition.events,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.push(`${opportunity.symbol} monitoring: ${reason}`);
        checks.push({
          opportunityId: opportunity.id,
          checkedAt: now.toISOString(),
          health: "unable",
          stateBefore: opportunity.state,
          stateAfter: opportunity.state,
          evidence: { reason },
          note: "Unable to assess; lifecycle not changed",
          events: [],
        });
      }
    }
    return { checks, failures };
  }

  private async fastMonitoring(
    config: ScannerConfig,
    now: Date,
    quotes: Cached<NormalizedQuote>,
    chains: Cached<NormalizedChain>
  ): Promise<{ checks: CheckInput[]; failures: string[] }> {
    const checks: CheckInput[] = [];
    const failures: string[] = [];

    for (const opportunity of this.store.listActiveOpportunities()) {
      if (Date.parse(opportunity.deadline) <= now.getTime()) continue;
      try {
        const quote = await cached(quotes, opportunity.symbol, () => this.market.quote(opportunity.symbol));
        const qHealth = quoteHealth(quote, config, now);
        if (qHealth.health !== "current" || quote.price === null) {
          const health = qHealth.health === "current" ? "unable" : qHealth.health;
          const note = qHealth.reason ?? "Underlying price is unavailable";
          if (opportunity.currentHealth !== health || checkDue(opportunity, now)) {
            checks.push({
              opportunityId: opportunity.id,
              checkedAt: now.toISOString(),
              health,
              stateBefore: opportunity.state,
              stateAfter: opportunity.state,
              evidence: { reason: note, quote },
              note,
              events: [],
            });
          }
          continue;
        }

        const priceOnly = priceOnlyTransition(opportunity, quote.price);
        if (priceOnly.state !== opportunity.state) {
          checks.push({
            opportunityId: opportunity.id,
            checkedAt: now.toISOString(),
            health: "current",
            stateBefore: opportunity.state,
            stateAfter: priceOnly.state,
            evidence: {
              price: quote.price,
              quoteTime: quote.quoteTime,
              quoteSource: quote.source,
              note: priceOnly.note,
            },
            note: priceOnly.note,
            events: priceOnly.events,
          });
          continue;
        }

        // Only setups sitting inside the entry band need the option chain; all
        // other checks stay quote-only so the fast pass remains cheap.
        const band =
          opportunity.state === "watching" && !CREDIT_STRATEGIES.has(opportunity.strategy)
            ? chaseBand(opportunity, quote.price)
            : null;
        if (band?.inBand) {
          const chain = await cached(chains, `${opportunity.symbol}:${opportunity.expiry}`, () =>
            this.market.chain(opportunity.symbol, opportunity.expiry)
          );
          const oHealth = optionHealth(opportunity, chain, config, now);
          if (oHealth.health !== "current") {
            checks.push({
              opportunityId: opportunity.id,
              checkedAt: now.toISOString(),
              health: oHealth.health,
              stateBefore: opportunity.state,
              stateAfter: opportunity.state,
              evidence: { reason: oHealth.reason, retrievedAt: chain.retrievedAt },
              note: oHealth.reason,
              events: [],
            });
            continue;
          }
          const transition = directionalState(opportunity, quote.price, now.toISOString());
          checks.push({
            opportunityId: opportunity.id,
            checkedAt: now.toISOString(),
            health: transition.ambiguous ? "unable" : "current",
            stateBefore: opportunity.state,
            stateAfter: transition.state,
            evidence: {
              price: quote.price,
              quoteTime: quote.quoteTime,
              quoteSource: quote.source,
              optionRetrievedAt: chain.retrievedAt,
              packageCredit: packageCredit(opportunity, chain),
              note: transition.note,
            },
            note: transition.note,
            events: transition.events,
          });
          continue;
        }

        if (checkDue(opportunity, now)) {
          const note =
            opportunity.state === "watching"
              ? `Waiting for entry; last price ${quote.price.toFixed(2)}`
              : "Monitoring; entry conditions unchanged";
          checks.push({
            opportunityId: opportunity.id,
            checkedAt: now.toISOString(),
            health: "current",
            stateBefore: opportunity.state,
            stateAfter: opportunity.state,
            evidence: { price: quote.price, quoteTime: quote.quoteTime, quoteSource: quote.source, note },
            note,
            events: [],
          });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.push(`${opportunity.symbol} fast monitoring: ${reason}`);
        if (opportunity.currentHealth !== "unable" || checkDue(opportunity, now)) {
          checks.push({
            opportunityId: opportunity.id,
            checkedAt: now.toISOString(),
            health: "unable",
            stateBefore: opportunity.state,
            stateAfter: opportunity.state,
            evidence: { reason },
            note: "Unable to assess; lifecycle not changed",
            events: [],
          });
        }
      }
    }

    return { checks, failures };
  }

  /**
   * Short-cadence quote pass for active setups. It can invalidate, mark an
   * entry as missed, or confirm entry only when the underlying is in band and
   * the legs verify; discovery and full monitoring stay on the scan cadence.
   */
  async runMonitoring(now = this.now()): Promise<MonitoringOutcome> {
    const config = this.store.getConfig();
    if (!config.enabled) return { status: "disabled" };
    if (!scannerReadiness(config).ready) return { status: "configuration" };
    if (!isRegularSessionOpen(now)) return { status: "market_closed" };

    const owner = this.store.newOwner();
    if (!this.store.acquireLease(owner, 120_000)) return { status: "overlap" };

    const quotes: Cached<NormalizedQuote> = new Map();
    const chains: Cached<NormalizedChain> = new Map();
    try {
      this.expireDeadlines(now);
      const result = await this.fastMonitoring(config, now, quotes, chains);
      for (const check of result.checks) this.store.appendCheck(check);
      for (const failure of result.failures) this.logger(failure);
      return { status: "completed", checks: result.checks.length };
    } finally {
      this.store.releaseLease(owner);
    }
  }

  private async assessNewOrChanged(config: ScannerConfig): Promise<void> {
    let remaining = this.maxAiAssessments;
    const pending = this.store
      .listActiveOpportunities()
      .filter((opportunity) => opportunity.aiStatus === "pending")
      .slice(0, this.maxAiAssessments);
    for (const opportunity of pending) {
      if (remaining <= 0) break;
      const previous = this.store.assessment(opportunity.id);
      const hash = scannerCandidateHash(opportunity);
      if (previous?.status === "ready" && previous.candidateHash === hash) continue;
      try {
        const assessment = await this.assess(opportunity, { config });
        this.store.saveAssessment(assessment);
        remaining -= 1;
      } catch (error) {
        this.store.saveAssessment({
          opportunityId: opportunity.id,
          candidateHash: hash,
          model: "unknown",
          promptVersion: "scanner-assessment-v1",
          schemaVersion: "1.0",
          status: "failed",
          output: null,
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          estimatedCostUsd: null,
          pricingSource: null,
          error: error instanceof Error ? error.message : String(error),
          createdAt: this.now().toISOString(),
        });
        this.logger(`AI assessment failed for ${opportunity.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async runScan(trigger: ScanRun["trigger"] = "scheduled"): Promise<ScanOutcome> {
    const now = this.now();
    const config = this.store.getConfig();
    if (!config.enabled) return { status: "disabled" };
    const readiness = scannerReadiness(config);
    if (!readiness.ready) return { status: "configuration" };
    if (!isRegularSessionOpen(now)) return { status: "market_closed" };

    const owner = this.store.newOwner();
    if (!this.store.acquireLease(owner, 10 * 60_000)) return { status: "overlap" };
    const runId = this.store.createRun(trigger, config.revision);
    const dataSource = getSettings().dataSource;
    const quotes: Cached<NormalizedQuote> = new Map();
    const histories: Cached<NormalizedHistory> = new Map();
    const expirationLists: Cached<string[]> = new Map();
    const chains: Cached<NormalizedChain> = new Map();

    try {
      this.expireDeadlines(now);
      const discovery = await this.discovery(
        config,
        now,
        quotes,
        histories,
        expirationLists,
        chains
      );
      const monitoring = await this.monitoring(config, now, quotes, chains);
      const currentConfig = this.store.getConfig();
      if (
        currentConfig.revision !== config.revision ||
        getSettings().dataSource !== dataSource
      ) {
        this.store.finishRun(runId, {
          status: "obsolete",
          coverage: discovery.coverage,
          failures: discovery.failures,
          candidates: discovery.candidates,
          qualified: 0,
          error:
            "Configuration or data source changed while the scan was running; results were discarded",
        });
        return { status: "obsolete", runId };
      }

      const created: OpportunityRecord[] = [];
      for (const candidate of discovery.discoveries) {
        const predecessor = this.store.latestTerminalForFamily(
          candidate.recipeId,
          candidate.symbol,
          candidate.horizon,
          candidate.direction,
          new Date(now.getTime() - 30 * 86_400_000).toISOString()
        );
        const persisted = this.store.persistDiscovery(
          candidate,
          config.revision,
          predecessor?.id ?? null,
          "pending"
        );
        if (persisted.created) created.push(persisted.record);
      }
      for (const check of monitoring.checks) this.store.appendCheck(check);
      for (const observation of discovery.observations) this.store.recordIvObservation(observation);

      const qualified = created.length;
      this.store.finishRun(runId, {
        status: "completed",
        coverage: discovery.coverage,
        failures: [...discovery.failures, ...monitoring.failures],
        candidates: discovery.candidates,
        qualified,
        error: null,
      });
      // The run is complete; release the scan lease so fast monitoring keeps
      // running while the (slower, paid) AI assessments finish.
      this.store.releaseLease(owner);
      try {
        await this.assessNewOrChanged(config);
      } catch (error) {
        this.logger(
          `AI assessment phase failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      return {
        status: "completed",
        runId,
        candidates: discovery.candidates,
        qualified,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.finishRun(runId, {
        status: "failed",
        error: message,
        failures: [message],
      });
      this.logger(`scan failed: ${message}`);
      return { status: "failed", runId, error: message };
    } finally {
      this.store.releaseLease(owner);
    }
  }
}

export function nextScheduledAt(
  config: ScannerConfig,
  last: ScanRun | null,
  now: Date
): string | null {
  if (!config.enabled) return null;
  const session = sessionState(now);
  if (session.state !== "open") return session.nextOpen;
  if (!last) return now.toISOString();
  const interval = config.scanIntervalMinutes * 60_000;
  return new Date(Math.max(now.getTime(), Date.parse(last.startedAt) + interval)).toISOString();
}
