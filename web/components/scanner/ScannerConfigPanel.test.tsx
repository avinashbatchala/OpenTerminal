import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ScannerConfig, ScannerStatus } from "../../lib/scanner";
import ScannerConfigPanel from "./ScannerConfigPanel";

function config(): ScannerConfig {
  return {
    enabled: false,
    revision: 1,
    watchlist: ["AAPL"],
    watchlistRevision: 1,
    fees: {
      currency: "USD",
      perOrderUsd: 0.65,
      entryPerContractUsd: 0.15,
      exitPerContractUsd: 0.15,
      expiryPerContractUsd: 0.15,
      confirmed: false,
    },
    horizons: {
      intraday: { minDays: 0, maxDays: 2, confirmed: false },
      swing: { minDays: 7, maxDays: 45, confirmed: false },
    },
    quotes: {
      maxUnderlyingAgeSeconds: 120,
      maxOptionAgeSeconds: 180,
      maxLegSkewSeconds: 90,
      maxBidAskWidthPct: 15,
      minVolume: 10,
      minOpenInterest: 100,
      confirmed: false,
    },
    selection: {
      maxStrikesPerSide: 30,
      targetStrikeDistancePct: 1.5,
      maxStrikeDistancePct: 10,
      minSpreadWidthPct: 1,
      maxSpreadWidthPct: 4,
      creditWingWidthPct: 1,
      slippagePct: 5,
      confirmed: false,
    },
    recipes: {} as ScannerConfig["recipes"],
    aiPricing: null,
    historyAssumptionAccepted: false,
    maxWatchlistSymbols: 25,
    scanIntervalMinutes: 5,
    updatedAt: null,
  };
}

const status: ScannerStatus = {
  config: config(),
  definitions: [],
  readiness: {
    ready: false,
    enabled: false,
    issues: ["Fee assumptions must be reviewed and confirmed"],
    warnings: ["Watchlist sync is empty"],
    recipes: [],
  },
  session: { state: "open", label: "Regular session", nextOpen: null, nextClose: null },
  lastRun: null,
  nextScheduledAt: null,
  monitoringGaps: [],
  pendingWatchlistRemovals: [],
  unreadNotifications: 0,
  aiUsage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: null, unknownCostAssessments: 0 },
};

describe("scanner configuration review", () => {
  it("shows draft status, activation blockers, and explicit review controls", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ScannerConfigPanel status={status} />
      </QueryClientProvider>
    );

    expect(screen.getByText("Activation is blocked")).toBeInTheDocument();
    expect(screen.getByText("Fee assumptions must be reviewed and confirmed")).toBeInTheDocument();
    expect(screen.getByText(/Scanner is disabled by default/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SAVE DRAFT" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "SAVE & ACTIVATE" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "PAUSE" })).toBeDisabled();
    expect(
      screen.getByText(/Entry, exit, and expiry charges are included in the \$250 modeled-loss screen/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Confirmed intraday|Confirm the intraday expiry range/)
    ).toBeInTheDocument();
  });
});
