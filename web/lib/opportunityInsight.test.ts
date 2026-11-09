import { describe, expect, it } from "vitest";
import type { AiAssessment, Opportunity } from "./scanner";
import {
  deadlineStatus,
  executionLevels,
  legRows,
  packageSummary,
  planLine,
  setupInsights,
  signalHighlights,
  tradeAction,
} from "./opportunityInsight";

const DEADLINE = "2026-11-20T14:30:00.000Z";

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    identityKey: "opp-1",
    muteKey: "mute-1",
    predecessorId: null,
    symbol: "AAPL",
    horizon: "swing",
    strategy: "long_call",
    direction: "bullish",
    recipeId: "TREND-PULLBACK",
    recipeVersion: "1.0.0",
    expiry: "2026-11-20",
    deadline: DEADLINE,
    state: "watching",
    dataHealth: "current",
    currentHealth: "current",
    pinned: false,
    dismissed: false,
    muted: false,
    archived: false,
    watchlistDecision: "monitor",
    configRevision: 1,
    createdAt: "2026-11-02T15:00:00.000Z",
    updatedAt: "2026-11-02T15:05:00.000Z",
    lastCheckedAt: "2026-11-02T15:05:00.000Z",
    legs: [
      {
        contractSymbol: "AAPL261120C00100000",
        underlying: "AAPL",
        expiry: "2026-11-20",
        optionType: "call",
        strike: 100,
        side: "buy",
        quantity: 1,
        ratio: 1,
        multiplier: 100,
        bid: 1,
        ask: 1.2,
        quoteTime: "2026-11-02T15:05:00.000Z",
        source: "schwab",
        deliverable: "100 AAPL",
        deliverableSource: "provider",
      },
    ],
    risk: {
      maxLossUsd: 121.75,
      feesUsd: 1.75,
      entryFeesUsd: 0.8,
      exitFeesUsd: 0.8,
      expiryFeesUsd: 0.15,
      netDebitUsd: 120,
      netCreditUsd: null,
      widthUsd: null,
      multiplier: 100,
      contracts: 1,
      slippageScenario: {
        label: "Illustrative 5% adverse premium scenario",
        netDebitUsd: 126,
        netCreditUsd: null,
        modeledLossUsd: 127.75,
        includedInRiskLimit: false,
      },
      assumptions: ["One complete strategy unit."],
    },
    signal: {
      recipeId: "TREND-PULLBACK",
      recipeVersion: "1.0.0",
      horizon: "swing",
      direction: "bullish",
      signalBarTime: "2026-11-02T14:30:00.000Z",
      features: {
        emaFast: 100.5,
        emaSlow: 98.2,
        emaSeparationPct: 2.34,
        signalBarHigh: 101.4,
        signalBarLow: 99.1,
        ignored: "text",
      },
      barsUsed: 80,
      source: "test",
    },
    conditions: {
      entry: "Cross 101.00",
      invalidation: "Cross 95.00",
      target: "Observe 105.00",
      deadline: DEADLINE,
      levels: {
        entry: 101,
        invalidation: 95,
        target: 105,
        chasePct: 0.35,
        rangeLow: null,
        rangeHigh: null,
        shortPut: null,
        shortCall: null,
        minCreditPerShare: null,
        frozenCreditPerShare: null,
        targetCreditFraction: null,
      },
    },
    thesis: "Deterministic trend pullback.",
    earnings: { checked: true, nextEarningsDate: null },
    currentEvidence: null,
    aiStatus: "ready",
    ...overrides,
  };
}

const assessment: AiAssessment = {
  opportunityId: "opp-1",
  status: "ready",
  output: {
    summary: "Defined risk.",
    thesis: "Trend continuation.",
    risks: ["Invalidation risk."],
    rank: 77,
    confidence: "medium",
  },
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  estimatedCostUsd: null,
  pricingSource: null,
  error: null,
  createdAt: "2026-11-02T15:06:00.000Z",
};

describe("trade action", () => {
  it("tells the user to wait and where the trigger sits", () => {
    const action = tradeAction(opportunity());
    expect(action.title).toBe("Wait for entry");
    expect(action.directive).toContain("above 101.00");
    expect(action.detail).toContain("95.00");
    expect(action.detail).toContain("105.00");
    expect(action.tone).toBe("amber");
  });

  it("switches to execute copy once entry is ready", () => {
    const action = tradeAction(opportunity({ state: "entry_ready" }));
    expect(action.title).toBe("Entry ready");
    expect(action.directive).toContain("Execute");
    expect(action.tone).toBe("up");
  });

  it("names the credit strikes to sell", () => {
    const action = tradeAction(
      opportunity({
        strategy: "bull_put_credit",
        direction: "bullish",
        legs: [
          {
            ...opportunity().legs[0],
            side: "sell",
            optionType: "put",
            strike: 95,
            contractSymbol: "AAPL261120P00095000",
          },
        ],
        conditions: {
          ...opportunity().conditions,
          levels: {
            ...opportunity().conditions.levels,
            entry: null,
            target: null,
            shortPut: 95,
            minCreditPerShare: 0.55,
          },
        },
      })
    );
    expect(action.directive).toContain("sell 95 put");
    expect(action.detail).toContain("0.55");
  });

  it("stands down on terminal states", () => {
    expect(tradeAction(opportunity({ state: "invalidated" })).directive).toBe("No action");
    expect(tradeAction(opportunity({ state: "expired" })).tone).toBe("dim");
  });
});

describe("deadline status", () => {
  const deadline = Date.parse(DEADLINE);

  it("counts hours inside a day", () => {
    expect(deadlineStatus(DEADLINE, deadline - 12 * 3_600_000)).toEqual({
      label: "12h left",
      tone: "amber",
    });
  });

  it("counts days beyond a day", () => {
    expect(deadlineStatus(DEADLINE, deadline - 4 * 86_400_000)).toEqual({
      label: "4d left",
      tone: "dim",
    });
  });

  it("flags a passed deadline", () => {
    expect(deadlineStatus(DEADLINE, deadline + 60_000).tone).toBe("down");
  });
});

describe("levels, legs and package", () => {
  it("shows the frozen directional levels", () => {
    expect(executionLevels(opportunity()).map((level) => level.label)).toEqual([
      "Entry",
      "Invalidation",
      "Target",
    ]);
  });

  it("builds a compact plan line", () => {
    expect(planLine(opportunity())).toBe("Entry 101.00, Invalidation 95.00, Target 105.00");
  });

  it("derives mid prices and per-share package price", () => {
    const [row] = legRows(opportunity());
    expect(row.mid).toBeCloseTo(1.1);
    expect(row.contract).toBe("AAPL 2026-11-20 100C");
    expect(packageSummary(opportunity())).toEqual({
      label: "Net debit",
      totalUsd: 120,
      perShare: 1.2,
    });
  });
});

describe("signal highlights", () => {
  it("labels recipe features and ignores non-numeric values", () => {
    const highlights = signalHighlights(opportunity());
    expect(highlights).toContainEqual({ label: "Fast EMA", value: "100.50" });
    expect(highlights).toContainEqual({ label: "EMA separation", value: "2.34%" });
    expect(highlights).toHaveLength(5);
  });
});

describe("setup insights", () => {
  it("summarises supports and watches from stored evidence", () => {
    const now = Date.parse(DEADLINE);
    const { supports, watches } = setupInsights(opportunity(), assessment, now);

    expect(supports.some((item) => item.text.includes("capped at the modeled max loss"))).toBe(true);
    expect(supports.some((item) => item.text.includes("liquidity gates"))).toBe(true);
    // AI confidence lives in its own section; the support list stays deterministic.
    expect(supports.some((item) => item.text.includes("confidence"))).toBe(false);
    expect(watches.some((item) => item.text.includes("AI assessment"))).toBe(false);
  });

  it("raises stale data and earnings before the deadline", () => {
    const { watches } = setupInsights(
      opportunity({
        currentHealth: "stale",
        earnings: { checked: true, nextEarningsDate: "2026-11-10T21:00:00.000Z" },
      }),
      null,
      Date.parse(DEADLINE)
    );

    expect(watches.some((item) => item.text.includes("Stale data"))).toBe(true);
    expect(watches.some((item) => item.text.includes("Earnings"))).toBe(true);
    expect(watches.some((item) => item.text.includes("AI assessment"))).toBe(true);
  });
});
