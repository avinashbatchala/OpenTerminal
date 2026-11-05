import { describe, expect, it } from "vitest";
import { RECIPES } from "./recipes.js";
import { evaluateSignals } from "./signals.js";
import type { Bar } from "./indicators.js";

const params = (id: keyof typeof RECIPES) =>
  Object.fromEntries(RECIPES[id].params.map((param) => [param.key, param.default]));

function bar(day: number, open: number, high: number, low: number, close: number, volume = 1000): Bar {
  return { time: Date.UTC(2026, 0, 1) / 1000 + day * 86_400, open, high, low, close, volume };
}

describe("deterministic recipe signals", () => {
  it("finds a bullish trend pullback on completed bars and mirrors bearish", () => {
    const rising: Bar[] = Array.from({ length: 80 }, (_, index) => {
      const close = 100 + index * 0.6;
      return bar(index, close - 0.2, close + 0.4, close - 0.3, close);
    });
    rising[rising.length - 1] = bar(79, 147, 148, 140, 147.4);
    const bullish = evaluateSignals("TREND-PULLBACK", "swing", rising, params("TREND-PULLBACK"));
    expect(bullish.signals).toHaveLength(1);
    expect(bullish.signals[0].direction).toBe("bullish");
    expect(bullish.signals[0].entry).toBeGreaterThan(bullish.signals[0].invalidation!);
    expect(bullish.signals[0].target).toBeGreaterThan(bullish.signals[0].entry!);

    const falling: Bar[] = Array.from({ length: 80 }, (_, index) => {
      const close = 150 - index * 0.6;
      return bar(index, close + 0.2, close + 0.3, close - 0.4, close);
    });
    falling[falling.length - 1] = bar(79, 103, 116, 102, 102.6);
    const bearish = evaluateSignals("TREND-PULLBACK", "swing", falling, params("TREND-PULLBACK"));
    expect(bearish.signals).toHaveLength(1);
    expect(bearish.signals[0].direction).toBe("bearish");
    expect(bearish.signals[0].entry).toBeLessThan(bearish.signals[0].invalidation!);
  });

  it("requires volume confirmation for a range breakout", () => {
    const prior: Bar[] = Array.from({ length: 25 }, (_, index) =>
      bar(index, 98, 100, 95, 99, 1000)
    );
    const quiet = [...prior, bar(25, 99, 100.5, 98.5, 101, 1000)];
    const quietResult = evaluateSignals("RANGE-BREAKOUT", "swing", quiet, params("RANGE-BREAKOUT"));
    expect(quietResult.signals).toHaveLength(0);
    expect(quietResult.issues.join(" ")).toContain("Relative volume");

    const active = [...prior, bar(25, 99, 101.5, 98.5, 101, 2500)];
    const result = evaluateSignals("RANGE-BREAKOUT", "swing", active, params("RANGE-BREAKOUT"));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].entry).toBeCloseTo(100.1);
    expect(result.signals[0].invalidation).toBe(95);
  });

  it("finds a mean-reversion re-entry and rejects a trending series via the exclusion", () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 55; i++) bars.push(bar(i, 100, 100.2, 99.8, 100, 1000));
    const path = [98, 96, 92, 88, 80];
    path.forEach((close, i) => bars.push(bar(55 + i, close + 1, close + 1, close - 1, close, 1200)));
    bars.push(bar(60, 80.5, 93.2, 80, 93, 3000));
    const meanParams = { ...params("MEAN-REVERSION"), trendSeparationPct: 10 };
    const result = evaluateSignals("MEAN-REVERSION", "swing", bars, meanParams);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].direction).toBe("bullish");
    expect(result.signals[0].target).toBeGreaterThan(result.signals[0].entry!);

    const stronglyTrending = bars.map((entry, index) =>
      bar(index, 100 + index, 101 + index, 99 + index, 100 + index, 1000)
    );
    const rejected = evaluateSignals(
      "MEAN-REVERSION",
      "swing",
      stronglyTrending,
      meanParams
    );
    expect(rejected.signals).toHaveLength(0);
  });

  it("qualifies a low-separation, bounded range for the volatility recipe", () => {
    const bars = Array.from({ length: 80 }, (_, index) => {
      const close = 100 + (index % 2 === 0 ? 0.5 : -0.5);
      return bar(index, close, 101, 99, close);
    });
    const result = evaluateSignals("VOLATILITY-RANGE", "swing", bars, params("VOLATILITY-RANGE"));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].direction).toBe("neutral");
    expect(result.signals[0].range).toEqual({ low: 99, high: 101 });
  });

  it("reports warm-up instead of inventing a signal", () => {
    const result = evaluateSignals(
      "RANGE-BREAKOUT",
      "swing",
      [bar(0, 100, 101, 99, 100)],
      params("RANGE-BREAKOUT")
    );
    expect(result.signals).toHaveLength(0);
    expect(result.issues.join(" ")).toContain("Warming up");
  });
});
