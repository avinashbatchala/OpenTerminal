import { createHash } from "node:crypto";
import { sessionDay } from "./calendar.js";
import { round } from "./indicators.js";
import type {
  Direction,
  FrozenConditions,
  Horizon,
  OpportunityCandidate,
  RiskModel,
  ScannerConfig,
  ScannerLeg,
  Strategy,
} from "./types.js";
import { RECIPE_VERSION } from "./types.js";
import type { SignalResult } from "./signals.js";
import type {
  NormalizedChain,
  NormalizedOption,
  NormalizedQuote,
} from "./market.js";

export type RiskResult =
  | { ok: true; risk: RiskModel }
  | { ok: false; reason: string };

export type CandidateBuildResult = {
  candidates: OpportunityCandidate[];
  issues: string[];
};

const MAX_RISK_USD = 250;
const SUPPORTED_MULTIPLIER = 100;

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function calendarDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function targetExpiry(
  dates: string[],
  horizon: Horizon,
  config: ScannerConfig,
  now: Date
): { expiry: string | null; dte: number | null; issues: string[] } {
  const range = config.horizons[horizon];
  const today = dateKey(now);
  const target = (range.minDays + range.maxDays) / 2;
  const eligible = dates
    .map((expiry) => ({ expiry, dte: calendarDaysBetween(today, expiry) }))
    .filter(
      (entry) =>
        Number.isFinite(entry.dte) &&
        entry.dte >= range.minDays &&
        entry.dte <= range.maxDays &&
        sessionDay(entry.expiry).isTradingDay
    )
    .sort(
      (a, b) =>
        Math.abs(a.dte - target) - Math.abs(b.dte - target) ||
        a.dte - b.dte ||
        a.expiry.localeCompare(b.expiry)
    );
  if (eligible.length === 0) {
    return {
      expiry: null,
      dte: null,
      issues: [
        `No listed expiry falls inside the configured ${horizon} range of ${range.minDays}-${range.maxDays} days`,
      ],
    };
  }
  return { expiry: eligible[0].expiry, dte: eligible[0].dte, issues: [] };
}

function qualityIssue(
  option: NormalizedOption,
  side: "buy" | "sell",
  config: ScannerConfig,
  now: Date
): string | null {
  if (option.multiplier !== SUPPORTED_MULTIPLIER) {
    return `Unsupported multiplier for ${option.contractSymbol}`;
  }
  if (!option.deliverable) return `Deliverable is unverified for ${option.contractSymbol}`;
  if (option.bid === null || option.ask === null || option.bid <= 0 || option.ask <= 0) {
    return `Missing or non-positive bid/ask for ${option.contractSymbol}`;
  }
  if (option.bid > option.ask) return `Crossed market for ${option.contractSymbol}`;
  const mid = (option.bid + option.ask) / 2;
  if (!mid || ((option.ask - option.bid) / mid) * 100 > config.quotes.maxBidAskWidthPct) {
    return `Bid/ask width exceeds the configured limit for ${option.contractSymbol}`;
  }
  if (side === "sell" && option.bid <= 0) return `No usable bid for short leg ${option.contractSymbol}`;
  if (option.volume === null || option.openInterest === null) {
    return `Missing liquidity data for ${option.contractSymbol}`;
  }
  if (option.volume < config.quotes.minVolume || option.openInterest < config.quotes.minOpenInterest) {
    return `Liquidity below configured minimum for ${option.contractSymbol}`;
  }
  if (!option.quoteTime) return `Missing option quote time for ${option.contractSymbol}`;
  const ageSeconds = (now.getTime() - Date.parse(option.quoteTime)) / 1000;
  if (!Number.isFinite(ageSeconds) || ageSeconds > config.quotes.maxOptionAgeSeconds) {
    return `Stale or unreadable option quote for ${option.contractSymbol}`;
  }
  return null;
}

function liquidityScore(option: NormalizedOption): number {
  return Math.min(option.volume ?? 0, option.openInterest ?? 0);
}

function nearest(
  options: NormalizedOption[],
  target: number,
  predicate: (option: NormalizedOption) => boolean = () => true
): NormalizedOption | null {
  return [...options]
    .filter(predicate)
    .sort(
      (a, b) =>
        Math.abs(a.strike - target) - Math.abs(b.strike - target) ||
        liquidityScore(b) - liquidityScore(a) ||
        a.contractSymbol.localeCompare(b.contractSymbol)
    )[0] ?? null;
}

function leg(option: NormalizedOption, side: "buy" | "sell"): ScannerLeg {
  return {
    contractSymbol: option.contractSymbol,
    underlying: option.underlying,
    expiry: option.expiry,
    optionType: option.optionType,
    strike: option.strike,
    side,
    quantity: 1,
    ratio: 1,
    multiplier: option.multiplier!,
    bid: option.bid,
    ask: option.ask,
    quoteTime: option.quoteTime,
    source: option.source,
    deliverable: option.deliverable,
    deliverableSource: option.deliverableSource,
  };
}

export function calculateRisk(
  strategy: Strategy,
  legs: ScannerLeg[],
  config: ScannerConfig
): RiskResult {
  if (legs.length === 0) return { ok: false, reason: "No legs" };
  const multipliers = new Set(legs.map((entry) => entry.multiplier));
  if (multipliers.size !== 1 || !multipliers.has(SUPPORTED_MULTIPLIER)) {
    return { ok: false, reason: "Legs do not share a supported multiplier" };
  }
  if (legs.some((entry) => entry.bid === null || entry.ask === null)) {
    return { ok: false, reason: "Leg quote is incomplete" };
  }
  const multiplier = legs[0].multiplier;
  const contracts = legs.reduce((sum, entry) => sum + entry.quantity, 0);
  const quotes = legs.map((entry) => ({
    ...entry,
    bid: entry.bid as number,
    ask: entry.ask as number,
  }));
  const entryFees =
    config.fees.perOrderUsd + config.fees.entryPerContractUsd * contracts;
  const exitFees =
    config.fees.perOrderUsd + config.fees.exitPerContractUsd * contracts;
  const expiryFees = config.fees.expiryPerContractUsd * contracts;
  const feesUsd = round(entryFees + exitFees + expiryFees, 2);

  let netDebit: number | null = null;
  let netCredit: number | null = null;
  let width: number | null = null;
  let expirationLoss: number | null = null;

  if (strategy === "long_call" || strategy === "long_put") {
    const option = quotes[0];
    netDebit = option.ask;
    expirationLoss = netDebit * multiplier;
  } else if (strategy === "debit_call_spread" || strategy === "debit_put_spread") {
    const long = quotes.find((entry) => entry.side === "buy");
    const short = quotes.find((entry) => entry.side === "sell");
    if (!long || !short) return { ok: false, reason: "Debit spread requires one buy and one sell leg" };
    netDebit = long.ask - short.bid;
    width = Math.abs(long.strike - short.strike);
    if (netDebit <= 0) return { ok: false, reason: "Debit spread is not a net debit" };
    if (width <= 0) return { ok: false, reason: "Debit spread has no positive width" };
    expirationLoss = netDebit * multiplier;
  } else if (strategy === "bull_put_credit" || strategy === "bear_call_credit") {
    const short = quotes.find((entry) => entry.side === "sell");
    const long = quotes.find((entry) => entry.side === "buy");
    if (!short || !long) return { ok: false, reason: "Credit spread requires one buy and one sell leg" };
    netCredit = short.bid - long.ask;
    width = Math.abs(short.strike - long.strike);
    if (netCredit <= 0) return { ok: false, reason: "Credit spread is not a net credit" };
    if (width <= 0) return { ok: false, reason: "Credit spread has no positive width" };
    if (netCredit >= width) return { ok: false, reason: "Credit exceeds spread width" };
    expirationLoss = (width - netCredit) * multiplier;
  } else {
    if (legs.length !== 4) return { ok: false, reason: "Iron condor requires four legs" };
    const shortPut = quotes.find((entry) => entry.optionType === "put" && entry.side === "sell");
    const longPut = quotes.find((entry) => entry.optionType === "put" && entry.side === "buy");
    const shortCall = quotes.find((entry) => entry.optionType === "call" && entry.side === "sell");
    const longCall = quotes.find((entry) => entry.optionType === "call" && entry.side === "buy");
    if (!shortPut || !longPut || !shortCall || !longCall) {
      return { ok: false, reason: "Iron condor legs are incomplete" };
    }
    netCredit = shortPut.bid + shortCall.bid - longPut.ask - longCall.ask;
    const putWidth = shortPut.strike - longPut.strike;
    const callWidth = longCall.strike - shortCall.strike;
    if (putWidth <= 0 || callWidth <= 0) {
      return { ok: false, reason: "Iron condor strikes are not ordered" };
    }
    if (netCredit <= 0) return { ok: false, reason: "Iron condor is not a net credit" };
    width = Math.max(putWidth, callWidth);
    if (netCredit >= width) return { ok: false, reason: "Iron condor credit exceeds maximum wing width" };
    expirationLoss = (width - netCredit) * multiplier;
  }

  if (expirationLoss === null || !Number.isFinite(expirationLoss) || expirationLoss < 0) {
    return { ok: false, reason: "Modeled expiration loss is invalid" };
  }
  const maxLossUsd = round(expirationLoss + feesUsd, 2);
  if (maxLossUsd > MAX_RISK_USD) {
    return {
      ok: false,
      reason: `Modeled loss $${maxLossUsd.toFixed(2)} exceeds the $${MAX_RISK_USD} limit`,
    };
  }

  const slippageRate = config.selection.slippagePct / 100;
  const premium = netDebit ?? netCredit ?? 0;
  const adversePremium = premium * slippageRate;
  const slippageDebit = netDebit === null ? null : netDebit + adversePremium;
  const slippageCredit = netCredit === null ? null : Math.max(0, netCredit - adversePremium);
  const slippageLoss =
    strategy === "long_call" || strategy === "long_put" || strategy === "debit_call_spread" || strategy === "debit_put_spread"
      ? (slippageDebit ?? 0) * multiplier
      : strategy === "iron_condor"
      ? (Math.max(0, (width ?? 0) - (slippageCredit ?? 0))) * multiplier
      : (Math.max(0, (width ?? 0) - (slippageCredit ?? 0))) * multiplier;

  return {
    ok: true,
    risk: {
      maxLossUsd,
      feesUsd,
      entryFeesUsd: round(entryFees, 2),
      exitFeesUsd: round(exitFees, 2),
      expiryFeesUsd: round(expiryFees, 2),
      netDebitUsd: netDebit === null ? null : round(netDebit * multiplier, 2),
      netCreditUsd: netCredit === null ? null : round(netCredit * multiplier, 2),
      widthUsd: width === null ? null : round(width * multiplier, 2),
      multiplier,
      contracts,
      slippageScenario: {
        label: `Illustrative ${config.selection.slippagePct}% adverse premium scenario`,
        netDebitUsd: slippageDebit === null ? null : round(slippageDebit * multiplier, 2),
        netCreditUsd:
          slippageCredit === null ? null : round(slippageCredit * multiplier, 2),
        modeledLossUsd: round(slippageLoss + feesUsd, 2),
        includedInRiskLimit: false,
      },
      assumptions: [
        "One complete strategy unit; leg quantities preserve the listed ratios.",
        "Observed buy legs use the ask and sell legs use the bid.",
        "Modeled loss includes entry, exit, and expiry fee assumptions.",
        "Slippage is shown separately and is not included in the $250 screening limit.",
        "This is a modeled expiration payoff, not a fill, position, or realized P&L.",
      ],
    },
  };
}

function allLegsSkewOk(legs: ScannerLeg[], config: ScannerConfig): string | null {
  const times = legs.map((entry) => (entry.quoteTime ? Date.parse(entry.quoteTime) : NaN));
  if (times.some((time) => !Number.isFinite(time))) return "A leg quote timestamp is missing";
  const skewSeconds = (Math.max(...times) - Math.min(...times)) / 1000;
  if (skewSeconds > config.quotes.maxLegSkewSeconds) {
    return `Inter-leg quote skew ${Math.round(skewSeconds)}s exceeds the configured limit`;
  }
  return null;
}

function identity(
  signal: SignalResult,
  symbol: string,
  strategy: Strategy,
  legs: ScannerLeg[]
) {
  const muteKey = createHash("sha256")
    .update(
      [
        signal.recipeId,
        RECIPE_VERSION,
        strategy,
        signal.horizon,
        symbol,
        signal.direction,
        signal.signalBarTime,
      ].join("|")
    )
    .digest("hex");
  const legKey = legs
    .map((entry) => `${entry.side}:${entry.contractSymbol}:${entry.ratio}`)
    .sort()
    .join("|");
  const identityKey = createHash("sha256").update(`${muteKey}|${legs[0].expiry}|${legKey}`).digest("hex");
  return { muteKey, identityKey };
}

function directionWord(direction: Direction): "bullish" | "bearish" | "neutral" {
  return direction;
}

function conditionsFor(
  signal: SignalResult,
  strategy: Strategy,
  legs: ScannerLeg[],
  risk: RiskModel,
  deadline: string,
  params: Record<string, number>
): FrozenConditions {
  if (strategy === "iron_condor") {
    const shortPut = legs.find((entry) => entry.optionType === "put" && entry.side === "sell");
    const shortCall = legs.find((entry) => entry.optionType === "call" && entry.side === "sell");
    const fraction = params.targetCreditFraction;
    const frozenCredit = (risk.netCreditUsd ?? 0) / risk.multiplier;
    return {
      entry: `Observe the configured range regime, fresh legs, and package credit at or above $${params.minNetCreditPerContract.toFixed(
        2
      )}/share on a subsequent check.`,
      invalidation: `Underlying crosses short put ${shortPut?.strike ?? "—"} or short call ${
        shortCall?.strike ?? "—"
      }.`,
      target: Number.isFinite(fraction)
        ? `Hypothetical package closing debit falls to ${(fraction * 100).toFixed(
            0
          )}% of the frozen $${frozenCredit.toFixed(2)} credit after entry readiness.`
        : null,
      deadline,
      levels: {
        entry: null,
        invalidation: null,
        target: null,
        chasePct: null,
        rangeLow: signal.range?.low ?? null,
        rangeHigh: signal.range?.high ?? null,
        shortPut: shortPut?.strike ?? null,
        shortCall: shortCall?.strike ?? null,
        minCreditPerShare: params.minNetCreditPerContract,
        frozenCreditPerShare: frozenCredit,
        targetCreditFraction: Number.isFinite(fraction) ? fraction : null,
      },
    };
  }
  if (strategy === "bull_put_credit" || strategy === "bear_call_credit") {
    const short = legs.find((entry) => entry.side === "sell");
    const fraction = params.targetCreditFraction;
    const frozenCredit = (risk.netCreditUsd ?? 0) / risk.multiplier;
    return {
      entry: `Underlying remains beyond the frozen invalidation level with fresh coherent quotes and package credit at or above $${params.minNetCreditPerContract.toFixed(
        2
      )}/share.`,
      invalidation: `Underlying reaches the frozen ${directionWord(signal.direction)} invalidation level ${
        signal.invalidation === null ? "—" : signal.invalidation.toFixed(2)
      }; short strike is ${short?.strike ?? "—"}.`,
      target: Number.isFinite(fraction)
        ? `Hypothetical package closing debit falls to ${(fraction * 100).toFixed(
            0
          )}% of the frozen credit after entry readiness.`
        : null,
      deadline,
      levels: {
        entry: signal.entry,
        invalidation: signal.invalidation,
        target: null,
        chasePct: Number.isFinite(params.chasePct) ? params.chasePct : null,
        rangeLow: signal.range?.low ?? null,
        rangeHigh: signal.range?.high ?? null,
        shortPut: short?.optionType === "put" ? short.strike : null,
        shortCall: short?.optionType === "call" ? short.strike : null,
        minCreditPerShare: params.minNetCreditPerContract,
        frozenCreditPerShare: frozenCredit,
        targetCreditFraction: Number.isFinite(fraction) ? fraction : null,
      },
    };
  }
  return {
    entry: `Verified underlying price crosses ${signal.entry === null ? "—" : signal.entry.toFixed(2)} ${
      signal.direction === "bullish" ? "from below" : "from above"
    }, without exceeding the configured chase distance.`,
    invalidation: `Verified underlying price crosses ${
      signal.invalidation === null ? "—" : signal.invalidation.toFixed(2)
    }.`,
    target:
      signal.target === null
        ? null
        : `Underlying-price milestone ${signal.target.toFixed(2)}; this is not option profit or a fill.`,
    deadline,
    levels: {
      entry: signal.entry,
      invalidation: signal.invalidation,
      target: signal.target,
      chasePct: Number.isFinite(params.chasePct) ? params.chasePct : null,
      rangeLow: signal.range?.low ?? null,
      rangeHigh: signal.range?.high ?? null,
      shortPut: null,
      shortCall: null,
      minCreditPerShare: null,
      frozenCreditPerShare: null,
      targetCreditFraction: null,
    },
  };
}

function thesisFor(signal: SignalResult, strategy: Strategy): string {
  const name = signal.recipeId.replaceAll("-", " ").toLowerCase();
  return `Deterministic ${name} signal with a ${directionWord(signal.direction)} bias; ${
    strategy === "iron_condor"
      ? "one defined-risk iron condor unit"
      : strategy.includes("credit")
      ? "one defined-risk credit spread unit"
      : strategy.includes("spread")
      ? "one defined-risk debit spread unit"
      : strategy.startsWith("long")
      ? "one long option contract"
      : "one strategy unit"
  }.`;
}

function candidateFromLegs(
  signal: SignalResult,
  symbol: string,
  strategy: Strategy,
  legs: ScannerLeg[],
  config: ScannerConfig,
  deadline: string,
  earnings: OpportunityCandidate["earnings"]
): CandidateBuildResult {
  const skew = allLegsSkewOk(legs, config);
  if (skew) return { candidates: [], issues: [skew] };
  const riskResult = calculateRisk(strategy, legs, config);
  if (!riskResult.ok) return { candidates: [], issues: [riskResult.reason] };
  const { muteKey, identityKey } = identity(signal, symbol, strategy, legs);
  const candidate: OpportunityCandidate = {
    identityKey,
    muteKey,
    symbol,
    horizon: signal.horizon,
    strategy,
    direction: signal.direction,
    recipeId: signal.recipeId,
    recipeVersion: RECIPE_VERSION,
    expiry: legs[0].expiry,
    deadline,
    legs,
    risk: riskResult.risk,
    signal: {
      recipeId: signal.recipeId,
      recipeVersion: RECIPE_VERSION,
      horizon: signal.horizon,
      direction: signal.direction,
      signalBarTime: signal.signalBarTime,
      features: signal.features,
      barsUsed: signal.barsUsed,
      source: "market-api",
    },
    thesis: thesisFor(signal, strategy),
    conditions: conditionsFor(
      signal,
      strategy,
      legs,
      riskResult.risk,
      deadline,
      config.recipes[signal.recipeId].params
    ),
    earnings,
    dataHealth: "current",
  };
  return { candidates: [candidate], issues: [] };
}

export function buildCandidates(
  signal: SignalResult,
  symbol: string,
  quote: NormalizedQuote,
  chain: NormalizedChain,
  expiry: string,
  config: ScannerConfig,
  now: Date,
  deadline: string,
  earnings: OpportunityCandidate["earnings"]
): CandidateBuildResult {
  const spot = quote.price ?? chain.underlyingPrice;
  if (spot === null || spot <= 0) return { candidates: [], issues: ["Underlying price is unavailable"] };
  // Freeze the strike-selection reference to the signal bar. Current quotes
  // validate freshness and risk, but a quote move must not renumber the legs.
  const referencePrice = signal.signalBar.close;
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    return { candidates: [], issues: ["Signal-bar reference price is unavailable"] };
  }
  if (!quote.quoteTime) return { candidates: [], issues: ["Underlying quote timestamp is missing"] };
  const underlyingAge = (now.getTime() - Date.parse(quote.quoteTime)) / 1000;
  if (!Number.isFinite(underlyingAge) || underlyingAge > config.quotes.maxUnderlyingAgeSeconds) {
    return { candidates: [], issues: ["Underlying quote is stale"] };
  }
  if (chain.issues.length) return { candidates: [], issues: chain.issues };
  const options = [...chain.calls, ...chain.puts];
  const qualityReasons = new Map<string, string>();
  for (const option of options) {
    const issue = qualityIssue(option, option.optionType === "call" ? "buy" : "buy", config, now);
    if (issue) qualityReasons.set(option.contractSymbol, issue);
  }
  const withinMoneynessBand = (option: NormalizedOption) =>
    Math.abs(option.strike - referencePrice) <=
    (referencePrice * config.selection.maxStrikeDistancePct) / 100 + 1e-9;
  const limitStrikes = (options: NormalizedOption[]) =>
    [...options]
      .sort(
        (a, b) =>
          Math.abs(a.strike - referencePrice) - Math.abs(b.strike - referencePrice) ||
          a.contractSymbol.localeCompare(b.contractSymbol)
      )
      .slice(0, config.selection.maxStrikesPerSide);
  const eligibleCalls = limitStrikes(
    chain.calls.filter(
      (option) => withinMoneynessBand(option) && !qualityIssue(option, "buy", config, now)
    )
  );
  const eligiblePuts = limitStrikes(
    chain.puts.filter(
      (option) => withinMoneynessBand(option) && !qualityIssue(option, "buy", config, now)
    )
  );
  if (eligibleCalls.length === 0 && eligiblePuts.length === 0) {
    const reasons = Array.from(new Set(qualityReasons.values())).slice(0, 3);
    return { candidates: [], issues: [`No contract passed quality gates: ${reasons.join("; ")}`] };
  }

  const direction = signal.direction;
  const calls = eligibleCalls.sort((a, b) => a.strike - b.strike);
  const puts = eligiblePuts.sort((a, b) => a.strike - b.strike);
  const candidates: OpportunityCandidate[] = [];
  const issues: string[] = [];
  const widthMin = (referencePrice * config.selection.minSpreadWidthPct) / 100;
  const widthMax = (referencePrice * config.selection.maxSpreadWidthPct) / 100;
  const wing = Math.min(
    Math.max((referencePrice * config.selection.creditWingWidthPct) / 100, widthMin),
    widthMax
  );

  const add = (strategy: Strategy, legs: ScannerLeg[]) => {
    const result = candidateFromLegs(signal, symbol, strategy, legs, config, deadline, earnings);
    candidates.push(...result.candidates);
    issues.push(...result.issues);
  };

  if (signal.recipeId === "VOLATILITY-RANGE" && signal.range) {
    if (spot < signal.range.low || spot > signal.range.high) {
      return { candidates: [], issues: ["Underlying is outside the frozen range"] };
    }
    const params = config.recipes["VOLATILITY-RANGE"].params;
    const buffer = params.shortBufferPct / 100;
    const shortPutTarget = signal.range.low * (1 - buffer);
    const shortCallTarget = signal.range.high * (1 + buffer);
    const shortPut = nearest(puts, shortPutTarget, (option) => option.strike <= shortPutTarget);
    const shortCall = nearest(calls, shortCallTarget, (option) => option.strike >= shortCallTarget);
    if (!shortPut || !shortCall) {
      return { candidates: [], issues: ["No strikes are available beyond both range edges"] };
    }
    const longPut = nearest(
      puts,
      shortPut.strike - wing,
      (option) => {
        const width = shortPut.strike - option.strike;
        return width >= widthMin && width <= widthMax;
      }
    );
    const longCall = nearest(
      calls,
      shortCall.strike + wing,
      (option) => {
        const width = option.strike - shortCall.strike;
        return width >= widthMin && width <= widthMax;
      }
    );
    if (!longPut || !longCall) {
      return { candidates: [], issues: ["No protective wings meet the configured width range"] };
    }
    add("iron_condor", [
      leg(shortPut, "sell"),
      leg(longPut, "buy"),
      leg(shortCall, "sell"),
      leg(longCall, "buy"),
    ]);
    return { candidates, issues };
  }

  if (signal.recipeId === "VOLATILITY-TREND-CREDIT" && signal.invalidation !== null) {
    const params = config.recipes["VOLATILITY-TREND-CREDIT"].params;
    const buffer = params.shortBufferPct / 100;
    if (direction === "bullish") {
      const shortTarget = signal.invalidation * (1 - buffer);
      const shortPut = nearest(puts, shortTarget, (option) => option.strike <= shortTarget);
      if (!shortPut) return { candidates: [], issues: ["No short put strike is beyond invalidation"] };
      const longPut = nearest(
        puts,
        shortPut.strike - wing,
        (option) => {
          const width = shortPut.strike - option.strike;
          return width >= widthMin && width <= widthMax;
        }
      );
      if (!longPut) return { candidates: [], issues: ["No protective put meets the width range"] };
      add("bull_put_credit", [leg(shortPut, "sell"), leg(longPut, "buy")]);
    } else {
      const shortTarget = signal.invalidation * (1 + buffer);
      const shortCall = nearest(calls, shortTarget, (option) => option.strike >= shortTarget);
      if (!shortCall) return { candidates: [], issues: ["No short call strike is beyond invalidation"] };
      const longCall = nearest(
        calls,
        shortCall.strike + wing,
        (option) => {
          const width = option.strike - shortCall.strike;
          return width >= widthMin && width <= widthMax;
        }
      );
      if (!longCall) return { candidates: [], issues: ["No protective call meets the width range"] };
      add("bear_call_credit", [leg(shortCall, "sell"), leg(longCall, "buy")]);
    }
    return { candidates, issues };
  }

  if (direction === "neutral") return { candidates: [], issues: ["Neutral recipe cannot build a directional unit"] };
  const isBull = direction === "bullish";
  const sideOptions = isBull ? calls : puts;
  const targetStrike =
    referencePrice *
    (1 + (isBull ? 1 : -1) * (config.selection.targetStrikeDistancePct / 100));
  const longOption = nearest(sideOptions, targetStrike);
  if (!longOption) return { candidates: [], issues: ["No long option passed quality gates"] };
  add(isBull ? "long_call" : "long_put", [leg(longOption, "buy")]);

  const targetWidth = (widthMin + widthMax) / 2;
  const shortCandidates = sideOptions.filter((option) => {
    const width = isBull ? option.strike - longOption.strike : longOption.strike - option.strike;
    return width >= widthMin && width <= widthMax;
  });
  const shortOption = [...shortCandidates].sort(
    (a, b) =>
      Math.abs(
        Math.abs(isBull ? a.strike - longOption.strike : longOption.strike - a.strike) - targetWidth
      ) -
        Math.abs(
          Math.abs(isBull ? b.strike - longOption.strike : longOption.strike - b.strike) - targetWidth
        ) ||
      liquidityScore(b) - liquidityScore(a) ||
      a.contractSymbol.localeCompare(b.contractSymbol)
  )[0];
  if (shortOption) {
    add(isBull ? "debit_call_spread" : "debit_put_spread", [
      leg(longOption, "buy"),
      leg(shortOption, "sell"),
    ]);
  } else {
    issues.push("No debit-spread short leg falls inside the configured width range");
  }
  return { candidates, issues };
}

export function selectExpiryForHorizon(
  dates: string[],
  horizon: Horizon,
  config: ScannerConfig,
  now: Date
) {
  return targetExpiry(dates, horizon, config, now);
}
