import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedChain, ScannerMarketData } from "../scanner/market.js";
import type { OpportunityRecord, ScannerLeg } from "../scanner/types.js";
import { createPaperBroker } from "./adapters/paper/broker.js";
import { modelFill, type FillModelConfig } from "./adapters/paper/fillModel.js";
import { ExecutionEngine } from "./engine.js";
import { createExecutionStore, type ExecutionStore } from "./store.js";

const CONTRACT = "AAPL261120C00100000";
const EXPIRY = "2026-11-20";
const NOW = new Date("2026-11-09T15:00:00.000Z");

const FILL_CONFIG: FillModelConfig = {
  spreadFactor: 1,
  impactBps: 0,
  jitterBps: 0,
  maxSlippagePct: 15,
  maxQuoteAgeMs: 180_000,
  fees: { perOrderUsd: 0.65, perContractUsd: 0.15 },
};

let db: Database.Database;
let store: ExecutionStore;
let engine: ExecutionEngine;
let setup: OpportunityRecord;
let ask: number;

function leg(askPrice: number): ScannerLeg {
  return {
    contractSymbol: CONTRACT,
    underlying: "AAPL",
    expiry: EXPIRY,
    optionType: "call",
    strike: 100,
    side: "buy",
    quantity: 1,
    ratio: 1,
    multiplier: 100,
    bid: askPrice - 0.2,
    ask: askPrice,
    quoteTime: NOW.toISOString(),
    source: "test",
    deliverable: "100 shares",
    deliverableSource: "provider",
  };
}

function opportunity(overrides: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return {
    id: "opp-1",
    identityKey: "identity-1",
    muteKey: "mute-1",
    predecessorId: null,
    symbol: "AAPL",
    horizon: "swing",
    strategy: "long_call",
    direction: "bullish",
    recipeId: "TREND-PULLBACK",
    recipeVersion: "1.0.0",
    expiry: EXPIRY,
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
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    lastCheckedAt: NOW.toISOString(),
    legs: [leg(1.2)],
    risk: {
      maxLossUsd: 130,
      feesUsd: 1.6,
      entryFeesUsd: 0.8,
      exitFeesUsd: 0.8,
      expiryFeesUsd: 0,
      netDebitUsd: 120,
      netCreditUsd: null,
      widthUsd: null,
      multiplier: 100,
      contracts: 1,
      slippageScenario: {
        label: "scenario",
        netDebitUsd: 126,
        netCreditUsd: null,
        modeledLossUsd: 127.6,
        includedInRiskLimit: false,
      },
      assumptions: [],
    },
    signal: {
      recipeId: "TREND-PULLBACK",
      recipeVersion: "1.0.0",
      horizon: "swing",
      direction: "bullish",
      signalBarTime: NOW.toISOString(),
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
    aiStatus: "ready",
    ...overrides,
  };
}

function chain(): NormalizedChain {
  const bid = Math.max(0.05, ask - 0.2);
  return {
    symbol: "AAPL",
    requestedExpiry: EXPIRY,
    selectedDate: EXPIRY,
    underlyingPrice: 101,
    expirationDates: [EXPIRY],
    calls: [
      {
        contractSymbol: CONTRACT,
        underlying: "AAPL",
        expiry: EXPIRY,
        optionType: "call",
        strike: 100,
        bid,
        ask,
        volume: 1000,
        openInterest: 1000,
        impliedVolatility: 0.3,
        quoteTime: NOW.toISOString(),
        source: "test",
        multiplier: 100,
        deliverable: "100 shares",
        deliverableSource: "provider",
      },
    ],
    puts: [],
    retrievedAt: NOW.toISOString(),
    source: "test",
    issues: [],
  };
}

function buildEngine() {
  const market = { chain: async () => chain() } as unknown as ScannerMarketData;
  const broker = createPaperBroker({
    fill: (request, at) =>
      modelFill({
        request,
        quotes: new Map([
          [
            CONTRACT,
            {
              contractSymbol: CONTRACT,
              bid: Math.max(0.05, ask - 0.2),
              ask,
              quoteTime: at.toISOString(),
              multiplier: 100,
            },
          ],
        ]),
        now: at,
        config: FILL_CONFIG,
        seed: request.clientOrderId,
      }),
    now: () => NOW,
    startingCashUsd: 100_000,
  });

  return new ExecutionEngine({
    store,
    broker,
    market,
    setups: { find: (id) => (id === setup.id ? setup : null) },
    now: () => NOW,
  });
}

beforeEach(() => {
  db = new Database(":memory:");
  store = createExecutionStore(db);
  ask = 1.2;
  setup = opportunity();
  engine = buildEngine();
});

afterEach(() => {
  engine.stop();
  db.close();
});

describe("execution engine", () => {
  it("opens a paper trade from an entry-ready setup", async () => {
    const result = await engine.enter(setup.id);
    if (!result.ok) throw new Error(`enter failed: ${result.error.kind}`);

    expect(result.value.status).toBe("open");
    expect(result.value.entrySummary?.netPricePerShare).toBeCloseTo(1.2);
    expect(result.value.entrySummary?.feesUsd).toBeCloseTo(0.8);
    expect(result.value.openedAt).toBe(NOW.toISOString());

    const detail = engine.getTrade(result.value.id)!;
    expect(detail.orders).toHaveLength(1);
    expect(detail.fills).toHaveLength(1);
    expect(detail.fills[0].slippageUsd).toBeCloseTo(10);
    expect(detail.events.some((event) => event.type === "trade_opened")).toBe(true);

    const status = await engine.status();
    expect(status.counts.open).toBe(1);
    expect(status.broker.ok).toBe(true);
  });

  it("refuses setups that are not entry-ready", async () => {
    setup = opportunity({ state: "watching" });
    const result = await engine.enter(setup.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("setup_not_ready");
    expect(store.listTrades()).toHaveLength(0);
  });

  it("refuses a second trade for the same opportunity", async () => {
    const first = await engine.enter(setup.id);
    expect(first.ok).toBe(true);
    const second = await engine.enter(setup.id);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe("already_traded");
  });

  it("fails without a current chain quote and creates no trade", async () => {
    const market = { chain: async () => ({ ...chain(), calls: [] }) } as unknown as ScannerMarketData;
    const broker = createPaperBroker({
      fill: () => ({ ok: false, error: { kind: "missing_quote", contractSymbol: CONTRACT } }),
      now: () => NOW,
    });
    const noQuoteEngine = new ExecutionEngine({
      store,
      broker,
      market,
      setups: { find: (id) => (id === setup.id ? setup : null) },
      now: () => NOW,
    });

    const result = await noQuoteEngine.enter(setup.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("market_data");
    expect(store.listTrades()).toHaveLength(0);
    noQuoteEngine.stop();
  });

  it("closes an open trade and records realized pnl", async () => {
    const entered = await engine.enter(setup.id);
    if (!entered.ok) throw new Error("enter failed");

    ask = 1.5;
    const closed = await engine.close(entered.value.id);
    if (!closed.ok) throw new Error(`close failed: ${closed.error.kind}`);

    expect(closed.value.status).toBe("closed");
    expect(closed.value.closedAt).toBe(NOW.toISOString());
    expect(closed.value.exitSummary?.netPricePerShare).toBeCloseTo(-1.3);
    expect(closed.value.pnl?.grossUsd).toBeCloseTo(10);
    expect(closed.value.pnl?.netUsd).toBeCloseTo(8.4);

    const status = await engine.status();
    expect(status.counts.closed).toBe(1);
    if (status.broker.ok) {
      expect(status.broker.positions).toHaveLength(0);
      expect(status.broker.cashUsd).toBeCloseTo(100_008.4);
    }
  });

  it("refuses concurrent operations while the lease is held", async () => {
    expect(store.acquireLease("other", 30_000)).toBe(true);
    const result = await engine.enter(setup.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("busy");
    store.releaseLease("other");
  });
});
