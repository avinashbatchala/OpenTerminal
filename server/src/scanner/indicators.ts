export type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };

export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}

export function ema(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const seed = sma(values.slice(0, period), period);
  if (seed === null) return null;
  const multiplier = 2 / (period + 1);
  let value = seed;
  for (let i = period; i < values.length; i++) {
    value = (values[i] - value) * multiplier + value;
  }
  return value;
}

/** Wilder RSI over completed closes. */
export function rsi(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const up = Math.max(change, 0);
    const down = Math.max(-change, 0);
    gain = (gain * (period - 1) + up) / period;
    loss = (loss * (period - 1) + down) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  const relativeStrength = gain / loss;
  return 100 - 100 / (1 + relativeStrength);
}

export function standardDeviation(values: number[], period: number): number | null {
  if (period <= 1 || values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((sum, value) => sum + value, 0) / period;
  const variance =
    slice.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
  return Math.sqrt(variance);
}

export function bollinger(values: number[], period: number, deviations: number) {
  const middle = sma(values, period);
  const sd = standardDeviation(values, period);
  if (middle === null || sd === null) return null;
  return { middle, upper: middle + deviations * sd, lower: middle - deviations * sd };
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function percentileRank(history: number[], current: number): number | null {
  if (history.length === 0 || !Number.isFinite(current)) return null;
  const lessOrEqual = history.filter((value) => value <= current).length;
  return (lessOrEqual / history.length) * 100;
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * 100;
}
