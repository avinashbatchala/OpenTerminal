import { describe, expect, it } from "vitest";
import {
  emptyState,
  formatUsd,
  legsSummary,
  type Opportunity,
  type ScannerStatus,
} from "./scanner";

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "a",
    identityKey: "a",
    muteKey: "m",
    predecessorId: null,
    symbol: "AAPL",
    horizon: "swing",
    strategy: "long_call",
    direction: "bullish",
    recipeId: "TREND-PULLBACK",
    recipeVersion: "1.0.0",
    expiry: "2026-11-20",
    deadline: "2026-11-20T14:30:00.000Z",
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
    updatedAt: "2026-11-02T15:00:00.000Z",
    lastCheckedAt: null,
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
        ask: 1.1,
        quoteTime: "2026-11-02T15:00:00.000Z",
        source: "test",
        deliverable: "100 shares",
        deliverableSource: "provider",
      },
    ],
    risk: {
      maxLossUsd: 111.75,
      feesUsd: 1.75,
      entryFeesUsd: 0.8,
      exitFeesUsd: 0.8,
      expiryFeesUsd: 0.15,
      netDebitUsd: 110,
      netCreditUsd: null,
      widthUsd: null,
      multiplier: 100,
      contracts: 1,
      slippageScenario: {
        label: "scenario",
        netDebitUsd: 115.5,
        netCreditUsd: null,
        modeledLossUsd: 117.25,
        includedInRiskLimit: false,
      },
      assumptions: [],
    },
    signal: {
      recipeId: "TREND-PULLBACK",
      recipeVersion: "1.0.0",
      horizon: "swing",
      direction: "bullish",
      signalBarTime: "2026-11-02T14:30:00.000Z",
      features: {},
      barsUsed: 80,
      source: "test",
    },
    conditions: {
      entry: "entry",
      invalidation: "invalidation",
      target: "target",
      deadline: "2026-11-20T14:30:00.000Z",
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
    thesis: "thesis",
    earnings: { checked: true, nextEarningsDate: null },
    currentEvidence: null,
    aiStatus: "pending",
    ...overrides,
  };
}

function status(overrides: Partial<ScannerStatus> = {}): ScannerStatus {
  return {
    config: {
      enabled: true,
      revision: 1,
      watchlist: ["AAPL"],
      watchlistRevision: 1,
      fees: { currency: "USD", perOrderUsd: 0.65, entryPerContractUsd: 0.15, exitPerContractUsd: 0.15, expiryPerContractUsd: 0.15, confirmed: true },
      horizons: {
        intraday: { minDays: 0, maxDays: 2, confirmed: true },
        swing: { minDays: 7, maxDays: 45, confirmed: true },
      },
      quotes: { maxUnderlyingAgeSeconds: 120, maxOptionAgeSeconds: 180, maxLegSkewSeconds: 90, maxBidAskWidthPct: 15, minVolume: 10, minOpenInterest: 100, confirmed: true },
      selection: { maxStrikesPerSide: 30, targetStrikeDistancePct: 1.5, maxStrikeDistancePct: 10, minSpreadWidthPct: 1, maxSpreadWidthPct: 4, creditWingWidthPct: 1, slippagePct: 5, confirmed: true },
      recipes: {} as ScannerStatus["config"]["recipes"],
      aiPricing: null,
      historyAssumptionAccepted: true,
      maxWatchlistSymbols: 25,
      scanIntervalMinutes: 5,
      updatedAt: null,
    },
    definitions: [],
    readiness: { ready: true, enabled: true, issues: [], warnings: [], recipes: [] },
    session: { state: "open", label: "Regular session", nextOpen: null, nextClose: null },
    lastRun: null,
    nextScheduledAt: null,
    monitoringGaps: [],
    pendingWatchlistRemovals: [],
    unreadNotifications: 0,
    aiUsage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: null, unknownCostAssessments: 0 },
    ...overrides,
  };
}

describe("scanner UI helpers", () => {
  it("distinguishes paused, unconfigured, market-closed, failed, and empty states", () => {
    expect(emptyState(status({ config: { ...status().config, enabled: false } }), [], false)?.title).toBe("Scanner is paused");
    expect(emptyState(status({ readiness: { ...status().readiness, ready: false, issues: ["missing fee"] } }), [], false)?.detail).toContain("missing fee");
    expect(emptyState(status({ session: { state: "closed", label: "Weekend", nextOpen: null, nextClose: null } }), [], false)?.title).toBe("Market closed");
    expect(emptyState(status({ lastRun: { id: 1, startedAt: "", finishedAt: null, status: "failed", trigger: "scheduled", coverage: [], failures: [], candidates: 0, qualified: 0, error: "provider down" } }), [], false)?.title).toBe("Last scan failed");
    expect(emptyState(status(), [], false)?.title).toBe("Waiting for the first scan");
    const completed = status({
      lastRun: {
        id: 1,
        startedAt: "2026-11-02T15:00:00.000Z",
        finishedAt: "2026-11-02T15:01:00.000Z",
        status: "completed",
        trigger: "scheduled",
        coverage: [],
        failures: [],
        candidates: 4,
        qualified: 0,
        error: null,
      },
    });
    expect(emptyState(completed, [], false)?.title).toBe("No qualifying opportunities");
    expect(emptyState(completed, [], true)?.title).toBe("No matches");
  });

  it("reports incomplete coverage without hiding the distinction from an empty scan", () => {
    const result = emptyState(
      status({
        lastRun: {
          id: 1,
          startedAt: "",
          finishedAt: null,
          status: "completed",
          trigger: "scheduled",
          coverage: [{ symbol: "AAPL", status: "failed", reason: "quote missing", recipes: {} }],
          failures: [],
          candidates: 0,
          qualified: 0,
          error: null,
        },
      }),
      [],
      false
    );
    expect(result?.title).toBe("Incomplete coverage");
  });

  it("formats exact legs and currency without implying an execution", () => {
    expect(legsSummary(opportunity())).toBe("+1 AAPL 2026-11-20 100C");
    expect(formatUsd(111.75)).toBe("$111.75");
    expect(formatUsd(null)).toBe("-");
  });
});
