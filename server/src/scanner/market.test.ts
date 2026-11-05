import { describe, expect, it } from "vitest";
import { normalizeHistory } from "./market.js";

function candle(time: number, close: number, volume = 1000) {
  return { time, open: close, high: close + 0.5, low: close - 0.5, close, volume };
}

describe("scanner history normalization", () => {
  it("excludes an incomplete intraday bar and requires five-minute spacing", () => {
    const start = Date.UTC(2026, 10, 2, 14, 30) / 1000; // 09:30 New York
    const rows = Array.from({ length: 30 }, (_, index) =>
      candle(start + index * 300, 100 + index * 0.1)
    );
    const now = new Date((start + 29 * 300 + 120) * 1000); // two minutes into the last bar
    const history = normalizeHistory("AAPL", "intraday", rows, now);
    expect(history.intervalSeconds).toBe(300);
    expect(history.issues).toHaveLength(0);
    expect(history.bars).toHaveLength(29);
    expect(history.bars.at(-1)?.time).toBe(start + 28 * 300);
    expect(history.adjusted).toBe(false);
  });

  it("rejects non-five-minute intraday spacing instead of silently relabeling it", () => {
    const start = Date.UTC(2026, 10, 2, 14, 30) / 1000;
    const rows = Array.from({ length: 10 }, (_, index) => candle(start + index * 60, 100));
    const now = new Date((start + 30 * 60) * 1000);
    const history = normalizeHistory("AAPL", "intraday", rows, now);
    expect(history.issues.join(" ")).toContain("Expected five-minute intraday bars");
    expect(history.bars).toHaveLength(0);
  });

  it("uses only completed daily swing bars, not the current session", () => {
    const previous = Date.UTC(2026, 9, 30) / 1000; // Friday, Oct 30
    const current = Date.UTC(2026, 10, 2) / 1000; // Nov 2
    const history = normalizeHistory(
      "AAPL",
      "swing",
      [candle(previous, 100), candle(current, 101)],
      new Date("2026-11-02T15:00:00Z") // regular session still open
    );
    expect(history.issues).toHaveLength(0);
    expect(history.bars.map((bar) => bar.time)).toEqual([previous]);
  });
});
