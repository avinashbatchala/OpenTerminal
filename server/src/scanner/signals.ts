import {
  average,
  bollinger,
  ema,
  pct,
  rsi,
  type Bar,
} from "./indicators.js";
import type { Direction, Horizon, RecipeId } from "./types.js";

export type SignalResult = {
  recipeId: RecipeId;
  horizon: Horizon;
  direction: Direction;
  signalBarTime: string;
  signalBar: Bar;
  barsUsed: number;
  entry: number | null;
  invalidation: number | null;
  target: number | null;
  range: { low: number; high: number } | null;
  features: Record<string, number | string | null>;
};

export type SignalEvaluation = {
  signals: SignalResult[];
  issues: string[];
};

function p(params: Record<string, number>, key: string): number {
  return params[key];
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function trendSignals(
  recipeId: RecipeId,
  horizon: Horizon,
  bars: Bar[],
  params: Record<string, number>
): SignalEvaluation {
  const fastPeriod = Math.round(p(params, "emaFast"));
  const slowPeriod = Math.round(p(params, "emaSlow"));
  const bufferPct = p(params, "bufferPct");
  const targetR = p(params, "targetR");
  const closes = bars.map((bar) => bar.close);
  if (bars.length < slowPeriod + 1) {
    return {
      signals: [],
      issues: [`Warming up: need at least ${slowPeriod + 1} completed bars`],
    };
  }
  const signal = bars[bars.length - 1];
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);
  if (fast === null || slow === null) {
    return { signals: [], issues: ["Unable to calculate EMA warm-up"] };
  }
  const buffer = signal.close * (bufferPct / 100);
  const signals: SignalResult[] = [];

  if (fast > slow && signal.low <= fast && signal.close > fast) {
    const entry = signal.high + buffer;
    const invalidation = signal.low - buffer;
    if (entry > invalidation) {
      signals.push({
        recipeId,
        horizon,
        direction: "bullish",
        signalBarTime: iso(signal.time),
        signalBar: signal,
        barsUsed: bars.length,
        entry,
        invalidation,
        target: entry + Math.max(0, targetR) * (entry - invalidation),
        range: null,
        features: {
          emaFast: fast,
          emaSlow: slow,
          emaSeparationPct: pct(fast - slow, signal.close),
          signalBarHigh: signal.high,
          signalBarLow: signal.low,
        },
      });
    }
  }
  if (fast < slow && signal.high >= fast && signal.close < fast) {
    const entry = signal.low - buffer;
    const invalidation = signal.high + buffer;
    if (entry < invalidation) {
      signals.push({
        recipeId,
        horizon,
        direction: "bearish",
        signalBarTime: iso(signal.time),
        signalBar: signal,
        barsUsed: bars.length,
        entry,
        invalidation,
        target: entry - Math.max(0, targetR) * (invalidation - entry),
        range: null,
        features: {
          emaFast: fast,
          emaSlow: slow,
          emaSeparationPct: pct(fast - slow, signal.close),
          signalBarHigh: signal.high,
          signalBarLow: signal.low,
        },
      });
    }
  }
  return { signals, issues: signals.length ? [] : ["No completed-bar trend-pullback signal"] };
}

function breakoutSignals(
  horizon: Horizon,
  bars: Bar[],
  params: Record<string, number>
): SignalEvaluation {
  const lookback = Math.round(p(params, "rangeBars"));
  if (bars.length < lookback + 2) {
    return { signals: [], issues: [`Warming up: need at least ${lookback + 2} completed bars`] };
  }
  const signal = bars[bars.length - 1];
  const prior = bars.slice(-(lookback + 1), -1);
  const rangeHigh = Math.max(...prior.map((bar) => bar.high));
  const rangeLow = Math.min(...prior.map((bar) => bar.low));
  const priorVolume = average(prior.map((bar) => bar.volume));
  if (priorVolume === null || priorVolume <= 0) {
    return { signals: [], issues: ["Comparable prior volume is unavailable"] };
  }
  const relativeVolume = signal.volume / priorVolume;
  if (relativeVolume < p(params, "relativeVolume")) {
    return {
      signals: [],
      issues: [
        `Relative volume ${relativeVolume.toFixed(2)}x is below the configured ${p(
          params,
          "relativeVolume"
        )}x threshold`,
      ],
    };
  }
  const breakoutBuffer = p(params, "breakoutBufferPct") / 100;
  const targetR = p(params, "targetR");
  const signals: SignalResult[] = [];
  const bullishLevel = rangeHigh * (1 + breakoutBuffer);
  if (signal.close > bullishLevel) {
    const invalidation = rangeLow;
    signals.push({
      recipeId: "RANGE-BREAKOUT",
      horizon,
      direction: "bullish",
      signalBarTime: iso(signal.time),
      signalBar: signal,
      barsUsed: bars.length,
      entry: bullishLevel,
      invalidation,
      target: bullishLevel + Math.max(0, targetR) * (bullishLevel - invalidation),
      range: { low: rangeLow, high: rangeHigh },
      features: {
        rangeHigh,
        rangeLow,
        relativeVolume,
        close: signal.close,
      },
    });
  }
  const bearishLevel = rangeLow * (1 - breakoutBuffer);
  if (signal.close < bearishLevel) {
    const invalidation = rangeHigh;
    signals.push({
      recipeId: "RANGE-BREAKOUT",
      horizon,
      direction: "bearish",
      signalBarTime: iso(signal.time),
      signalBar: signal,
      barsUsed: bars.length,
      entry: bearishLevel,
      invalidation,
      target: bearishLevel - Math.max(0, targetR) * (invalidation - bearishLevel),
      range: { low: rangeLow, high: rangeHigh },
      features: {
        rangeHigh,
        rangeLow,
        relativeVolume,
        close: signal.close,
      },
    });
  }
  return {
    signals,
    issues: signals.length ? [] : ["No completed-bar range breakout signal"],
  };
}

function meanReversionSignals(
  horizon: Horizon,
  bars: Bar[],
  params: Record<string, number>
): SignalEvaluation {
  const period = Math.round(p(params, "bbPeriod"));
  const rsiPeriod = Math.round(p(params, "rsiPeriod"));
  const trendFast = Math.round(p(params, "trendEmaFast"));
  const trendSlow = Math.round(p(params, "trendEmaSlow"));
  const warmup = Math.max(period + 1, rsiPeriod + 1, trendSlow + 1);
  if (bars.length < warmup) {
    return {
      signals: [],
      issues: [`Warming up: need at least ${warmup} completed bars`],
    };
  }
  const current = bars[bars.length - 1];
  const previous = bars[bars.length - 2];
  const history = bars.slice(0, -1);
  const closes = history.map((bar) => bar.close);
  const bands = bollinger(closes, period, p(params, "bbStdDev"));
  const previousRsi = rsi(closes, rsiPeriod);
  if (!bands || previousRsi === null) {
    return { signals: [], issues: ["Unable to calculate mean-reversion indicators"] };
  }
  const allCloses = bars.map((bar) => bar.close);
  const fast = ema(allCloses, trendFast);
  const slow = ema(allCloses, trendSlow);
  if (fast === null || slow === null) {
    return { signals: [], issues: ["Unable to calculate the trend exclusion"] };
  }
  const separationPct = Math.abs(pct(fast - slow, current.close));
  if (separationPct > p(params, "trendSeparationPct")) {
    return {
      signals: [],
      issues: [
        `Trend exclusion: EMA separation ${separationPct.toFixed(2)}% exceeds ${p(
          params,
          "trendSeparationPct"
        )}%`,
      ],
    };
  }

  const buffer = current.close * (p(params, "bufferPct") / 100);
  const extremeBars = Math.max(1, Math.round(p(params, "extremeBars")));
  const extremes = bars.slice(-extremeBars);
  const signals: SignalResult[] = [];

  if (previous.close < bands.lower && previousRsi <= p(params, "rsiOversold") && current.close > bands.lower && current.close < bands.upper) {
    const entry = current.high + buffer;
    const invalidation = Math.min(...extremes.map((bar) => bar.low)) - buffer;
    const target = bands.middle;
    if (target > entry && entry > invalidation) {
      signals.push({
        recipeId: "MEAN-REVERSION",
        horizon,
        direction: "bullish",
        signalBarTime: iso(current.time),
        signalBar: current,
        barsUsed: bars.length,
        entry,
        invalidation,
        target,
        range: { low: bands.lower, high: bands.upper },
        features: {
          previousClose: previous.close,
          lowerBand: bands.lower,
          middleBand: bands.middle,
          upperBand: bands.upper,
          previousRsi,
          trendSeparationPct: separationPct,
        },
      });
    }
  }
  if (previous.close > bands.upper && previousRsi >= p(params, "rsiOverbought") && current.close < bands.upper && current.close > bands.lower) {
    const entry = current.low - buffer;
    const invalidation = Math.max(...extremes.map((bar) => bar.high)) + buffer;
    const target = bands.middle;
    if (target < entry && entry < invalidation) {
      signals.push({
        recipeId: "MEAN-REVERSION",
        horizon,
        direction: "bearish",
        signalBarTime: iso(current.time),
        signalBar: current,
        barsUsed: bars.length,
        entry,
        invalidation,
        target,
        range: { low: bands.lower, high: bands.upper },
        features: {
          previousClose: previous.close,
          lowerBand: bands.lower,
          middleBand: bands.middle,
          upperBand: bands.upper,
          previousRsi,
          trendSeparationPct: separationPct,
        },
      });
    }
  }
  return {
    signals,
    issues: signals.length ? [] : ["No completed-bar mean-reversion signal"],
  };
}

function volatilityRangeSignal(
  horizon: Horizon,
  bars: Bar[],
  params: Record<string, number>
): SignalEvaluation {
  const slow = Math.round(p(params, "emaSlow"));
  const rangeBars = Math.round(p(params, "rangeBars"));
  if (bars.length < Math.max(slow + 1, rangeBars + 1)) {
    return {
      signals: [],
      issues: [`Warming up: need at least ${Math.max(slow + 1, rangeBars + 1)} completed bars`],
    };
  }
  const current = bars[bars.length - 1];
  const closes = bars.map((bar) => bar.close);
  const fast = ema(closes, Math.round(p(params, "emaFast")));
  const slowEma = ema(closes, slow);
  if (fast === null || slowEma === null) {
    return { signals: [], issues: ["Unable to calculate the range regime"] };
  }
  const separationPct = Math.abs(pct(fast - slowEma, current.close));
  const prior = bars.slice(-(rangeBars + 1), -1);
  const rangeHigh = Math.max(...prior.map((bar) => bar.high));
  const rangeLow = Math.min(...prior.map((bar) => bar.low));
  const rangePct = pct(rangeHigh - rangeLow, current.close);
  if (separationPct > p(params, "maxEmaSeparationPct")) {
    return {
      signals: [],
      issues: [
        `Regime held: EMA separation ${separationPct.toFixed(2)}% exceeds ${p(
          params,
          "maxEmaSeparationPct"
        )}%`,
      ],
    };
  }
  if (rangePct > p(params, "maxRangePct")) {
    return {
      signals: [],
      issues: [`Regime held: range width ${rangePct.toFixed(2)}% exceeds ${p(params, "maxRangePct")}%`],
    };
  }
  return {
    signals: [
      {
        recipeId: "VOLATILITY-RANGE",
        horizon,
        direction: "neutral",
        signalBarTime: iso(current.time),
        signalBar: current,
        barsUsed: bars.length,
        entry: null,
        invalidation: null,
        target: null,
        range: { low: rangeLow, high: rangeHigh },
        features: {
          emaFast: fast,
          emaSlow: slowEma,
          emaSeparationPct: separationPct,
          rangeHigh,
          rangeLow,
          rangePct,
        },
      },
    ],
    issues: [],
  };
}

export function evaluateSignals(
  recipeId: RecipeId,
  horizon: Horizon,
  bars: Bar[],
  params: Record<string, number>
): SignalEvaluation {
  switch (recipeId) {
    case "TREND-PULLBACK":
      return trendSignals(recipeId, horizon, bars, params);
    case "RANGE-BREAKOUT":
      return breakoutSignals(horizon, bars, params);
    case "MEAN-REVERSION":
      return meanReversionSignals(horizon, bars, params);
    case "VOLATILITY-RANGE":
      return volatilityRangeSignal(horizon, bars, params);
    case "VOLATILITY-TREND-CREDIT":
      return trendSignals(recipeId, horizon, bars, params);
  }
}
