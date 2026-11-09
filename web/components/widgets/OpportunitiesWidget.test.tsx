import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet } from "../../lib/api";
import type { Opportunity, ScannerStatus } from "../../lib/scanner";
import OpportunitiesWidget from "./OpportunitiesWidget";

vi.mock("../../lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}));

const apiGetMock = vi.mocked(apiGet);

function opportunity(overrides: Partial<Opportunity>): Opportunity {
  return {
    id: "opp",
    identityKey: "opp",
    muteKey: "mute",
    predecessorId: null,
    symbol: "AAPL",
    horizon: "intraday",
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
    lastCheckedAt: "2026-11-02T15:00:00.000Z",
    legs: [],
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
        netDebitUsd: null,
        netCreditUsd: null,
        modeledLossUsd: 117.25,
        includedInRiskLimit: false,
      },
      assumptions: [],
    },
    signal: {
      recipeId: "TREND-PULLBACK",
      recipeVersion: "1.0.0",
      horizon: "intraday",
      direction: "bullish",
      signalBarTime: "2026-11-02T14:30:00.000Z",
      features: {},
      barsUsed: 80,
      source: "test",
    },
    conditions: {
      entry: "Cross 101.00",
      invalidation: "Cross 95.00",
      target: "Observe 105.00",
      deadline: "2026-11-20T14:30:00.000Z",
      levels: {
        entry: 101,
        invalidation: 95,
        target: 105,
        chasePct: null,
        rangeLow: null,
        rangeHigh: null,
        shortPut: null,
        shortCall: null,
        minCreditPerShare: null,
        frozenCreditPerShare: null,
        targetCreditFraction: null,
      },
    },
    thesis: "Thesis",
    earnings: { checked: true, nextEarningsDate: null },
    currentEvidence: null,
    aiStatus: "pending",
    ...overrides,
  };
}

const intraday = opportunity({ id: "opp-intraday", symbol: "AAPL", horizon: "intraday" });
const swing = opportunity({ id: "opp-swing", symbol: "MSFT", horizon: "swing" });

const status: ScannerStatus = {
  config: {
    enabled: true,
    revision: 1,
    watchlist: ["AAPL", "MSFT"],
    watchlistRevision: 1,
    fees: {
      currency: "USD",
      perOrderUsd: 0.65,
      entryPerContractUsd: 0.15,
      exitPerContractUsd: 0.15,
      expiryPerContractUsd: 0.15,
      confirmed: true,
    },
    horizons: {
      intraday: { minDays: 0, maxDays: 2, confirmed: true },
      swing: { minDays: 7, maxDays: 45, confirmed: true },
    },
    quotes: {
      maxUnderlyingAgeSeconds: 120,
      maxOptionAgeSeconds: 180,
      maxLegSkewSeconds: 90,
      maxBidAskWidthPct: 15,
      minVolume: 10,
      minOpenInterest: 100,
      confirmed: true,
    },
    selection: {
      maxStrikesPerSide: 30,
      targetStrikeDistancePct: 1.5,
      maxStrikeDistancePct: 10,
      minSpreadWidthPct: 1,
      maxSpreadWidthPct: 4,
      creditWingWidthPct: 1,
      slippagePct: 5,
      confirmed: true,
    },
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
};

beforeEach(() => {
  apiGetMock.mockReset();
  apiGetMock.mockImplementation(async (path: string) => {
    if (path === "/api/scanner/status") return status;
    if (path.startsWith("/api/scanner/opportunities?")) {
      return path.includes("horizon=swing") ? [swing] : [intraday];
    }
    if (path.startsWith("/api/scanner/opportunities/")) {
      const id = decodeURIComponent(path.split("/").pop() ?? "");
      const selected = id === swing.id ? swing : intraday;
      return { opportunity: selected, checks: [], events: [], assessment: null };
    }
    if (path === "/api/scanner/notifications?unread=true") return [];
    throw new Error(`Unexpected request: ${path}`);
  });
});

function renderWidget() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OpportunitiesWidget />
    </QueryClientProvider>
  );
}

describe("opportunities widget", () => {
  it("lists setups and clears the open setup when the horizon changes", async () => {
    renderWidget();

    const intradayRow = await screen.findByRole("button", { name: /AAPL/ });
    fireEvent.click(intradayRow);

    expect(
      await screen.findByRole("heading", { name: /AAPL · Long call · INTRADAY/ })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /swing/i }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /AAPL · Long call/ })).not.toBeInTheDocument();
    });
    expect(await screen.findByText("MSFT")).toBeInTheDocument();
  });

  it("shows the paused state and offers scanner settings", async () => {
    apiGetMock.mockImplementation(async (path: string) => {
      if (path === "/api/scanner/status") {
        return {
          ...status,
          config: { ...status.config, enabled: false },
          readiness: { ...status.readiness, ready: false, issues: ["Enable a recipe"] },
        };
      }
      if (path.startsWith("/api/scanner/opportunities?")) return [];
      if (path === "/api/scanner/notifications?unread=true") return [];
      throw new Error(`Unexpected request: ${path}`);
    });

    renderWidget();

    expect(await screen.findByText("Scanner is paused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /scanner settings/i })).toBeInTheDocument();
  });
});
