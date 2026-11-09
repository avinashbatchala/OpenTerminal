import {
  STRATEGY_LABELS,
  formatDateTime,
  formatUsd,
  type AiAssessment,
  type Opportunity,
  type RecipeId,
} from "./scanner";

/**
 * Deterministic, presentation-only derivations for the scanner UI.
 * Nothing here changes eligibility, levels, risk or lifecycle; it only turns
 * the stored setup into plain-language answers: what to do, why, and what
 * could go wrong.
 */

export type Tone = "amber" | "up" | "down" | "dim";

const CREDIT_STRATEGIES = new Set(["bull_put_credit", "bear_call_credit", "iron_condor"]);

export function isCreditStrategy(strategy: string): boolean {
  return CREDIT_STRATEGIES.has(strategy);
}

export function strategyLabel(strategy: string): string {
  return STRATEGY_LABELS[strategy] ?? strategy.replaceAll("_", " ");
}

function price(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

export function stateLabel(opportunity: Pick<Opportunity, "state">): string {
  return opportunity.state.replaceAll("_", " ");
}

export type DeadlineStatus = { label: string; tone: Tone };

export function deadlineStatus(deadline: string, now = Date.now()): DeadlineStatus {
  const target = Date.parse(deadline);
  if (!Number.isFinite(target)) return { label: "Unknown deadline", tone: "dim" };
  const remaining = target - now;
  if (remaining <= 0) return { label: "Deadline passed", tone: "down" };
  const hours = remaining / 3_600_000;
  if (hours < 24) return { label: `${Math.max(1, Math.round(hours))}h left`, tone: "amber" };
  const days = Math.floor(hours / 24);
  const remainder = Math.round(hours % 24);
  return {
    label: remainder > 0 ? `${days}d ${remainder}h left` : `${days}d left`,
    tone: hours < 72 ? "amber" : "dim",
  };
}

export type TradeAction = {
  title: string;
  directive: string;
  detail: string;
  tone: Tone;
};

export function tradeAction(opportunity: Opportunity, now = Date.now()): TradeAction {
  const levels = opportunity.conditions.levels;

  if (opportunity.state === "expired") {
    return {
      title: "Expired",
      directive: "No action",
      detail: "The deadline passed before entry. Review the history if you still want the idea.",
      tone: "dim",
    };
  }

  if (opportunity.state === "invalidated") {
    return {
      title: "Invalidated",
      directive: "No action",
      detail: "The invalidation level was verified. The setup is closed and will not re-arm.",
      tone: "down",
    };
  }

  if (isCreditStrategy(opportunity.strategy)) {
    const shortLegs = opportunity.legs.filter((leg) => leg.side === "sell");
    const strikes = shortLegs
      .map((leg) => `${leg.strike} ${leg.optionType}`)
      .join(" / ");
    const minimum = levels.minCreditPerShare;
    const strikeText = strikes || "the short strikes";
    if (opportunity.state === "entry_ready") {
      return {
        title: "Entry ready",
        directive: `Execute: sell ${strikeText}`,
        detail: `Collect at least ${price(minimum)}/share. Close or stand down if the underlying crosses the frozen short strikes.`,
        tone: "up",
      };
    }
    return {
      title: "Wait for entry",
      directive: `Wait: sell ${strikeText}`,
      detail: `Enter only when the package pays at least ${price(minimum)}/share${
        levels.rangeLow !== null && levels.rangeHigh !== null
          ? ` and price sits inside ${price(levels.rangeLow)}–${price(levels.rangeHigh)}`
          : levels.invalidation !== null
            ? ` and price remains beyond ${price(levels.invalidation)}`
            : ""
      }.`,
      tone: "amber",
    };
  }

  const direction = opportunity.direction === "bearish" ? "below" : "above";
  const chase =
    levels.chasePct === null || !Number.isFinite(levels.chasePct)
      ? null
      : `Do not chase more than ${levels.chasePct.toFixed(2)}% beyond the trigger.`;
  const invalidation =
    levels.invalidation === null ? null : `Invalidation ${price(levels.invalidation)}`;
  const target = levels.target === null ? null : `first milestone ${price(levels.target)}`;
  const riskText = [invalidation, target].filter(Boolean).join("; ");

  if (opportunity.state === "entry_ready") {
    return {
      title: "Entry ready",
      directive: `Execute ${direction} ${price(levels.entry)}`,
      detail: [chase, riskText].filter(Boolean).join(" "),
      tone: "up",
    };
  }

  return {
    title: "Wait for entry",
    directive: `Trigger ${direction} ${price(levels.entry)}`,
    detail: [chase, riskText].filter(Boolean).join(" "),
    tone: "amber",
  };
}

export type LevelTile = {
  label: string;
  value: string;
  tone: Tone;
  hint: string;
};

export function executionLevels(opportunity: Opportunity): LevelTile[] {
  const levels = opportunity.conditions.levels;

  if (opportunity.strategy === "iron_condor") {
    return [
      {
        label: "Short put",
        value: levels.shortPut === null ? "—" : price(levels.shortPut),
        tone: "down",
        hint: "Sell this put strike; the long put wing is the defined risk.",
      },
      {
        label: "Short call",
        value: levels.shortCall === null ? "—" : price(levels.shortCall),
        tone: "down",
        hint: "Sell this call strike; the long call wing is the defined risk.",
      },
      {
        label: "Minimum credit",
        value: `${price(levels.minCreditPerShare)}/sh`,
        tone: "amber",
        hint: "Do not open the package below this observed credit.",
      },
    ];
  }

  if (isCreditStrategy(opportunity.strategy)) {
    const short = opportunity.legs.find((leg) => leg.side === "sell");
    return [
      {
        label: "Short strike",
        value: short ? `${short.strike} ${short.optionType}` : "—",
        tone: "down",
        hint: "The short leg carries the directional risk; the long leg caps it.",
      },
      {
        label: "Invalidation",
        value: levels.invalidation === null ? "—" : price(levels.invalidation),
        tone: "down",
        hint: opportunity.conditions.invalidation,
      },
      {
        label: "Minimum credit",
        value: `${price(levels.minCreditPerShare)}/sh`,
        tone: "amber",
        hint: "Do not open the package below this observed credit.",
      },
    ];
  }

  return [
    {
      label: "Entry",
      value: levels.entry === null ? "—" : price(levels.entry),
      tone: "amber",
      hint: opportunity.conditions.entry,
    },
    {
      label: "Invalidation",
      value: levels.invalidation === null ? "—" : price(levels.invalidation),
      tone: "down",
      hint: opportunity.conditions.invalidation,
    },
    {
      label: "Target",
      value: levels.target === null ? "—" : price(levels.target),
      tone: "up",
      hint: opportunity.conditions.target ?? "No target configured.",
    },
  ];
}

/** One-line plan for compact list rows. */
export function planLine(opportunity: Opportunity): string {
  return executionLevels(opportunity)
    .map((level) => `${level.label} ${level.value}`)
    .join(" · ");
}

type FeatureFormat = "price" | "pct" | "number" | "volume";

const RECIPE_FEATURES: Record<
  RecipeId,
  Array<{ key: string; label: string; format: FeatureFormat }>
> = {
  "TREND-PULLBACK": [
    { key: "emaFast", label: "Fast EMA", format: "price" },
    { key: "emaSlow", label: "Slow EMA", format: "price" },
    { key: "emaSeparationPct", label: "EMA separation", format: "pct" },
    { key: "signalBarHigh", label: "Signal high", format: "price" },
    { key: "signalBarLow", label: "Signal low", format: "price" },
  ],
  "RANGE-BREAKOUT": [
    { key: "rangeHigh", label: "Range high", format: "price" },
    { key: "rangeLow", label: "Range low", format: "price" },
    { key: "relativeVolume", label: "Relative volume", format: "volume" },
    { key: "close", label: "Signal close", format: "price" },
  ],
  "MEAN-REVERSION": [
    { key: "previousRsi", label: "Prior RSI", format: "number" },
    { key: "lowerBand", label: "Lower band", format: "price" },
    { key: "middleBand", label: "Middle band", format: "price" },
    { key: "upperBand", label: "Upper band", format: "price" },
    { key: "trendSeparationPct", label: "EMA separation", format: "pct" },
  ],
  "VOLATILITY-RANGE": [
    { key: "emaSeparationPct", label: "EMA separation", format: "pct" },
    { key: "rangeHigh", label: "Range high", format: "price" },
    { key: "rangeLow", label: "Range low", format: "price" },
    { key: "rangePct", label: "Range width", format: "pct" },
  ],
  "VOLATILITY-TREND-CREDIT": [
    { key: "emaFast", label: "Fast EMA", format: "price" },
    { key: "emaSlow", label: "Slow EMA", format: "price" },
    { key: "emaSeparationPct", label: "EMA separation", format: "pct" },
    { key: "signalBarHigh", label: "Signal high", format: "price" },
    { key: "signalBarLow", label: "Signal low", format: "price" },
  ],
};

function formatFeature(value: number, format: FeatureFormat): string {
  if (format === "pct") return `${value.toFixed(2)}%`;
  if (format === "volume") return `${value.toFixed(2)}×`;
  if (format === "number") return value.toFixed(1);
  return value.toFixed(2);
}

export type SignalHighlight = { label: string; value: string };

export function signalHighlights(opportunity: Opportunity): SignalHighlight[] {
  const fields = RECIPE_FEATURES[opportunity.recipeId] ?? [];
  const highlights: SignalHighlight[] = [];
  for (const field of fields) {
    const value = opportunity.signal.features[field.key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    highlights.push({ label: field.label, value: formatFeature(value, field.format) });
  }
  return highlights;
}

export type Insight = { tone: Tone; text: string };

export function setupInsights(
  opportunity: Opportunity,
  assessment: AiAssessment | null,
  now = Date.now()
): { supports: Insight[]; watches: Insight[] } {
  const supports: Insight[] = [];
  const watches: Insight[] = [];
  const levels = opportunity.conditions.levels;
  const deadline = deadlineStatus(opportunity.deadline, now);
  const earnings = opportunity.earnings;
  const earningsBeforeDeadline =
    earnings.nextEarningsDate !== null &&
    Date.parse(earnings.nextEarningsDate) <= Date.parse(opportunity.deadline);
  const horizonBars = opportunity.horizon === "intraday" ? "five-minute" : "daily";

  supports.push({
    tone: "up",
    text: "Risk is capped at the modeled max loss; entry, exit and expiry fees are included.",
  });

  if (opportunity.legs.length > 0) {
    supports.push({
      tone: "up",
      text: `${opportunity.legs.length} leg${opportunity.legs.length === 1 ? "" : "s"} passed the scanner's quote, spread-width and liquidity gates.`,
    });
  }

  if (opportunity.signal.barsUsed > 0) {
    supports.push({
      tone: "up",
      text: `Signal confirmed on completed ${horizonBars} bars (${opportunity.signal.barsUsed} bars used).`,
    });
  }

  if (earnings.checked && !earningsBeforeDeadline) {
    supports.push({
      tone: "up",
      text: "No known earnings event before the setup deadline.",
    });
  }

  if (
    levels.entry !== null ||
    levels.shortPut !== null ||
    levels.shortCall !== null
  ) {
    supports.push({
      tone: "up",
      text: isCreditStrategy(opportunity.strategy)
        ? "Frozen short strikes and minimum credit are defined."
        : "Frozen entry, invalidation and target are defined.",
    });
  }

  if (opportunity.currentHealth === "current") {
    supports.push({
      tone: "up",
      text: "Underlying and option quotes were current at the last check.",
    });
  }

  if (opportunity.currentHealth !== "current") {
    watches.push({
      tone: opportunity.currentHealth === "stale" ? "amber" : "down",
      text: `${opportunity.currentHealth === "stale" ? "Stale" : "Unavailable"} data at the last check — re-verify quotes before acting.`,
    });
  }

  if (earningsBeforeDeadline && earnings.nextEarningsDate) {
    watches.push({
      tone: "amber",
      text: `Earnings ${formatDateTime(earnings.nextEarningsDate)} falls before the deadline.`,
    });
  }

  if (deadline.tone !== "dim" && opportunity.state !== "expired") {
    watches.push({
      tone: deadline.tone,
      text: `Only ${deadline.label.toLowerCase()} until the setup deadline.`,
    });
  }

  if (!isCreditStrategy(opportunity.strategy) && levels.target === null) {
    watches.push({ tone: "amber", text: "No underlying-price target is configured." });
  }

  if (assessment?.status !== "ready") {
    watches.push({
      tone: "dim",
      text: `AI assessment ${assessment?.status ?? opportunity.aiStatus}; deterministic gates still govern the setup.`,
    });
  }

  if (opportunity.risk.slippageScenario.modeledLossUsd > opportunity.risk.maxLossUsd) {
    watches.push({
      tone: "dim",
      text: `Under ${opportunity.risk.slippageScenario.label.toLowerCase()}, modeled loss rises to ${formatUsd(
        opportunity.risk.slippageScenario.modeledLossUsd
      )}; slippage is excluded from the risk limit.`,
    });
  }

  return { supports: supports.slice(0, 5), watches: watches.slice(0, 5) };
}

export type LegRow = {
  key: string;
  side: "buy" | "sell";
  contractSymbol: string;
  contract: string;
  strike: number;
  optionType: "call" | "put";
  expiry: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  quantity: number;
  ratio: number;
};

export function legRows(opportunity: Opportunity): LegRow[] {
  return opportunity.legs.map((leg) => ({
    key: `${leg.contractSymbol}-${leg.side}-${leg.quantity}`,
    side: leg.side,
    contractSymbol: leg.contractSymbol,
    contract: `${leg.underlying} ${leg.expiry} ${leg.strike}${leg.optionType === "call" ? "C" : "P"}`,
    strike: leg.strike,
    optionType: leg.optionType,
    expiry: leg.expiry,
    bid: leg.bid,
    ask: leg.ask,
    mid:
      leg.bid !== null && leg.ask !== null && Number.isFinite(leg.bid) && Number.isFinite(leg.ask)
        ? (leg.bid + leg.ask) / 2
        : null,
    quantity: leg.quantity,
    ratio: leg.ratio,
  }));
}

export type PackageSummary = {
  label: "Net debit" | "Net credit" | "Package price";
  totalUsd: number | null;
  perShare: number | null;
};

export function packageSummary(opportunity: Opportunity): PackageSummary {
  const { netDebitUsd, netCreditUsd, multiplier } = opportunity.risk;
  if (netDebitUsd !== null) {
    return {
      label: "Net debit",
      totalUsd: netDebitUsd,
      perShare: multiplier > 0 ? netDebitUsd / multiplier : null,
    };
  }
  if (netCreditUsd !== null) {
    return {
      label: "Net credit",
      totalUsd: netCreditUsd,
      perShare: multiplier > 0 ? netCreditUsd / multiplier : null,
    };
  }
  return { label: "Package price", totalUsd: null, perShare: null };
}

export function expiryLabel(expiry: string): string {
  const date = new Date(`${expiry}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return expiry;
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}
