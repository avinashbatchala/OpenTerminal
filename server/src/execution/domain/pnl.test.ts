import { describe, expect, it } from "vitest";
import type { FillSummary } from "./fill.js";
import { computeTradePnl } from "./pnl.js";

function summary(netPricePerShare: number, feesUsd: number): FillSummary {
  return {
    legs: [
      {
        contractSymbol: "AAPL261120C00100000",
        side: netPricePerShare >= 0 ? "buy" : "sell",
        quantity: 1,
        multiplier: 100,
        referenceMid: Math.abs(netPricePerShare),
        fillPrice: Math.abs(netPricePerShare),
        feesUsd,
        slippageUsd: 0,
        at: "2026-11-09T15:00:00.000Z",
      },
    ],
    feesUsd,
    slippageUsd: 0,
    netPricePerShare,
    midPricePerShare: netPricePerShare,
    slippagePctOfMid: 0,
    filledAt: "2026-11-09T15:00:00.000Z",
  };
}

describe("trade pnl", () => {
  it("realizes a long debit trade", () => {
    const result = computeTradePnl(summary(1.2, 0.8), summary(-1.3, 0.8));
    if (!result.ok) throw new Error("pnl failed");
    expect(result.value.grossUsd).toBe(10);
    expect(result.value.feesUsd).toBeCloseTo(1.6);
    expect(result.value.netUsd).toBeCloseTo(8.4);
  });

  it("realizes a short credit trade", () => {
    // Sell at 0.9 credit, buy back at 0.3 debit.
    const result = computeTradePnl(summary(-0.9, 0.8), summary(0.3, 0.8));
    if (!result.ok) throw new Error("pnl failed");
    expect(result.value.grossUsd).toBe(60);
    expect(result.value.netUsd).toBeCloseTo(58.4);
  });

  it("rejects mismatched multipliers", () => {
    const exit = summary(-1.3, 0.8);
    const mismatched: FillSummary = {
      ...exit,
      legs: exit.legs.map((leg) => ({ ...leg, multiplier: 10 })),
    };
    expect(computeTradePnl(summary(1.2, 0.8), mismatched).ok).toBe(false);
  });
});
