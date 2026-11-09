import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet } from "../../lib/api";
import type {
  ExecutionDetail,
  ExecutionMark,
  ExecutionStatus,
  ExecutionTrade,
} from "../../lib/paper";
import PaperWidget from "./PaperWidget";

vi.mock("../../lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}));

const apiGetMock = vi.mocked(apiGet);

const MARK: ExecutionMark = {
  tradeId: "paper-open",
  markedAt: "2026-11-09T15:30:00.000Z",
  liquidationValueUsd: 100,
  underlyingPrice: 101,
};

function trade(overrides: Partial<ExecutionTrade>): ExecutionTrade {
  return {
    id: "paper-open",
    opportunityId: "opp-open",
    identityKey: "identity-open",
    symbol: "AAPL",
    horizon: "swing",
    strategy: "long_call",
    status: "open",
    setup: {} as ExecutionTrade["setup"],
    entryOrderId: "paper-open:entry",
    exitOrderId: null,
    entrySummary: {
      legs: [
        {
          contractSymbol: "AAPL261120C00100000",
          side: "buy",
          quantity: 1,
          multiplier: 100,
          referenceMid: 1.1,
          fillPrice: 1.2,
          feesUsd: 0.8,
          slippageUsd: 10,
          at: "2026-11-09T15:00:00.000Z",
        },
      ],
      feesUsd: 0.8,
      slippageUsd: 10,
      netPricePerShare: 1.2,
      midPricePerShare: 1.1,
      slippagePctOfMid: 9.09,
      filledAt: "2026-11-09T15:00:00.000Z",
    },
    exitSummary: null,
    pnl: null,
    createdAt: "2026-11-09T15:00:00.000Z",
    updatedAt: "2026-11-09T15:30:00.000Z",
    openedAt: "2026-11-09T15:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

const openTrade = trade({});
const closedTrade = trade({
  id: "paper-closed",
  opportunityId: "opp-closed",
  symbol: "MSFT",
  status: "closed",
  entrySummary: null,
  exitSummary: null,
  pnl: {
    grossUsd: 10,
    feesUsd: 1.6,
    netUsd: 8.4,
    entryNetPerShare: 1.2,
    exitNetPerShare: -1.3,
    multiplier: 100,
  },
  openedAt: "2026-11-09T14:00:00.000Z",
  closedAt: "2026-11-09T15:00:00.000Z",
});

const status: ExecutionStatus = {
  config: {
    enabled: true,
    startingCashUsd: 100_000,
    automation: { entries: false, exits: true },
    exits: { profitTargetFraction: 0.5, stopLossFraction: 1, timeStopMinutes: null },
    slippage: { spreadFactor: 1, impactBps: 0, jitterBps: 0, maxSlippagePct: 50 },
    quotes: { maxQuoteAgeMs: 180_000, limitBufferPct: 0.5 },
    fees: { perOrderUsd: 0.65, perContractUsd: 0.15 },
    limits: { maxOpenTrades: 5, maxPerSymbol: 1 },
  },
  counts: {
    pending_entry: 0,
    open: 1,
    pending_exit: 0,
    closed: 1,
    rejected: 0,
    cancelled: 0,
  },
  openTrades: [openTrade],
  latestMarks: { "paper-open": MARK },
  equity: {
    asOf: "2026-11-09T15:30:00.000Z",
    cashUsd: 99_897.2,
    positionsUsd: 100,
    equityUsd: 99_997.2,
  },
  broker: { ok: true, cashUsd: 99_897.2, positions: [] },
};

const detail: ExecutionDetail = {
  trade: openTrade,
  orders: [],
  fills: [
    {
      fillId: "fill-1",
      clientOrderId: "paper-open:entry",
      tradeId: openTrade.id,
      contractSymbol: "AAPL261120C00100000",
      side: "buy",
      quantity: 1,
      price: 1.2,
      referenceMid: 1.1,
      multiplier: 100,
      slippageUsd: 10,
      feesUsd: 0.8,
      filledAt: "2026-11-09T15:00:00.000Z",
    },
  ],
  marks: [MARK],
  events: [
    {
      id: 1,
      tradeId: openTrade.id,
      type: "trade_opened",
      dedupeKey: "trade:paper-open:opened",
      payload: {},
      createdAt: "2026-11-09T15:00:00.000Z",
    },
  ],
};

beforeEach(() => {
  apiGetMock.mockReset();
  apiGetMock.mockImplementation(async (path: string) => {
    if (path === "/api/execution/status") return status;
    if (path === "/api/execution/trades?limit=200") return [openTrade, closedTrade];
    if (path === "/api/execution/equity?limit=200") {
      return { latest: status.equity, history: [status.equity] };
    }
    if (path.startsWith("/api/execution/trades/")) return detail;
    throw new Error(`Unexpected request: ${path}`);
  });
});

function renderWidget() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PaperWidget />
    </QueryClientProvider>
  );
}

describe("paper trading widget", () => {
  it("shows equity, open positions and closed pnl", async () => {
    renderWidget();

    expect(await screen.findByText("$99,997.20")).toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText(/-?\$20\.00/)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /history/i }));
    const closedRow = await screen.findByRole("button", { name: /MSFT/ });
    expect(within(closedRow).getByText(/\+?\$8\.40/)).toBeInTheDocument();
  });

  it("opens trade detail with fills and lifecycle", async () => {
    renderWidget();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /AAPL/ }));

    const dialog = await screen.findByRole("dialog", { name: "Paper trade" });
    expect(dialog).toBeInTheDocument();
    expect(await screen.findByText("AAPL261120C00100000")).toBeInTheDocument();
    expect(screen.getByText(/trade opened/i)).toBeInTheDocument();
    await waitFor(() => expect(apiGetMock).toHaveBeenCalledWith(
      "/api/execution/trades/paper-open",
      expect.anything()
    ));
  });
});
