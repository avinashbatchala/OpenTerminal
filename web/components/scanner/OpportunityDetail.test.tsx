import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet } from "../../lib/api";
import type { Opportunity } from "../../lib/scanner";
import OpportunityDetail from "./OpportunityDetail";

vi.mock("../../lib/api", () => ({ apiGet: vi.fn() }));
const apiGetMock = vi.mocked(apiGet);

const opportunity: Opportunity = {
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
  deadline: "2026-11-20T14:30:00.000Z",
  state: "entry_ready",
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
      ask: 1.1,
      quoteTime: "2026-11-02T15:05:00.000Z",
      source: "schwab",
      deliverable: "100 AAPL",
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
      label: "Illustrative 5% adverse premium scenario",
      netDebitUsd: 115.5,
      netCreditUsd: null,
      modeledLossUsd: 117.25,
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
};

beforeEach(() => {
  apiGetMock.mockReset();
});

describe("scanner opportunity detail", () => {
  it("renders exact legs, assumptions, chronological checks, events, and usage", async () => {
    apiGetMock.mockResolvedValue({
      opportunity,
      checks: [
        {
          id: 1,
          opportunityId: "opp-1",
          checkedAt: "2026-11-02T15:05:00.000Z",
          health: "current",
          stateBefore: "watching",
          stateAfter: "entry_ready",
          evidence: { price: 101.2 },
          note: "Entry observed",
        },
      ],
      events: [
        {
          id: 1,
          opportunityId: "opp-1",
          type: "entry_ready",
          dedupeKey: "entry:opp-1:101",
          createdAt: "2026-11-02T15:05:00.000Z",
          payload: {},
        },
      ],
      assessment: {
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
      },
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <OpportunityDetail opportunityId="opp-1" onPin={vi.fn()} onDismiss={vi.fn()} />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByText(/AAPL · Long call/)).toBeInTheDocument());
    expect(screen.getByText("AAPL261120C00100000")).toBeInTheDocument();
    expect(screen.getByText(/\$111.75/)).toBeInTheDocument();
    expect(screen.getByText(/One complete strategy unit/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Opportunity legs" })).toHaveClass("overflow-x-auto");
    expect(screen.getByText("Entry observed")).toBeInTheDocument();
    expect(screen.getAllByText(/entry ready/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Execute above 101.00/)).toBeInTheDocument();
    expect(screen.getByText("Why it's in play")).toBeInTheDocument();
    expect(screen.getByText("Supports the setup")).toBeInTheDocument();
    expect(screen.getByText("Watch before acting")).toBeInTheDocument();
    expect(screen.getByText(/Defined risk/)).toBeInTheDocument();
    expect(screen.getByText(/Tokens: 100 in \/ 50 out/)).toBeInTheDocument();
    expect(screen.getByText(/estimated cost unknown/)).toBeInTheDocument();
  });
});
