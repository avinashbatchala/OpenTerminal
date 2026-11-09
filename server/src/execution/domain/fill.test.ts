import { describe, expect, it } from "vitest";
import { legSlippage, summarizeLegFills, type LegFill } from "./fill.js";

function leg(overrides: Partial<LegFill> = {}): LegFill {
  return {
    contractSymbol: "AAPL261120C00100000",
    side: "buy",
    quantity: 1,
    multiplier: 100,
    referenceMid: 1,
    fillPrice: 1.1,
    feesUsd: 0.8,
    slippageUsd: legSlippage("buy", 1.1, 1, 1, 100),
    at: "2026-11-09T15:00:00.000Z",
    ...overrides,
  };
}

describe("fill summary", () => {
  it("nets a debit package and reports slippage", () => {
    const result = summarizeLegFills([leg()]);
    if (!result.ok) throw new Error("summary failed");

    expect(result.value.netPricePerShare).toBeCloseTo(1.1);
    expect(result.value.midPricePerShare).toBeCloseTo(1);
    expect(result.value.slippageUsd).toBeCloseTo(10);
    expect(result.value.slippagePctOfMid).toBeCloseTo(10);
    expect(result.value.feesUsd).toBeCloseTo(0.8);
  });

  it("nets a credit package negatively and still charges slippage as a cost", () => {
    const sell = leg({
      side: "sell",
      fillPrice: 0.9,
      referenceMid: 1,
      slippageUsd: legSlippage("sell", 0.9, 1, 1, 100),
    });
    const result = summarizeLegFills([sell]);
    if (!result.ok) throw new Error("summary failed");

    expect(result.value.netPricePerShare).toBeCloseTo(-0.9);
    expect(result.value.slippageUsd).toBeCloseTo(10);
  });

  it("rejects empty or invalid legs", () => {
    expect(summarizeLegFills([]).ok).toBe(false);
    expect(summarizeLegFills([leg({ quantity: 0 })]).ok).toBe(false);
    expect(summarizeLegFills([leg({ fillPrice: 0 })]).ok).toBe(false);
    expect(summarizeLegFills([leg({ referenceMid: 0 })]).ok).toBe(false);
  });
});
