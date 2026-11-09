import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedChain, ScannerMarketData } from "../scanner/market.js";
import type { OpportunityRecord, ScannerLeg } from "../scanner/types.js";
import { createPaperBroker } from "./adapters/paper/broker.js";
import { modelFill, type FillModelConfig } from "./adapters/paper/fillModel.js";
import { ExecutionEngine } from "./engine.js";
import { asClientOrderId } from "./ports/broker.js";
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
let entryCandidates: OpportunityRecord[];
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
    setups: {
      find: (id) => (id === setup.id ? setup : null),
      listEntryReady: () => entryCandidates,
    },
    now: () => NOW,
  });
}

beforeEach(() => {
  db = new Database(":memory:");
  store = createExecutionStore(db);
  ask = 1.2;
  setup = opportunity();
  entryCandidates = [];
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
      setups: {
      find: (id) => (id === setup.id ? setup : null),
      listEntryReady: () => entryCandidates,
    },
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

describe("execution automation", () => {
  function enable(overrides: Record<string, unknown> = {}) {
    const current = store.getConfig();
    store.saveConfig({
      ...current,
      enabled: true,
      automation: { entries: false, exits: false },
      ...overrides,
    } as typeof current);
  }

  it("enters entry-ready setups when automation entries are enabled", async () => {
    enable({ automation: { entries: true, exits: false } });
    entryCandidates = [setup];

    const outcome = await engine.automate(NOW);

    expect(outcome.status).toBe("completed");
    expect(outcome.entries).toBe(1);
    expect(store.listOpenTrades()).toHaveLength(1);
  });

  it("exits on the package profit target", async () => {
    const entered = await engine.enter(setup.id);
    if (!entered.ok) throw new Error("enter failed");
    ask = 2;

    enable({
      automation: { entries: false, exits: true },
      exits: { profitTargetFraction: 0.5, stopLossFraction: 1, timeStopMinutes: null },
    });
    const outcome = await engine.automate(NOW);

    expect(outcome.exits).toBe(1);
    const detail = engine.getTrade(entered.value.id)!;
    expect(detail.trade.status).toBe("closed");
    expect(detail.trade.pnl?.grossUsd).toBeCloseTo(60);
    const requested = detail.events.find((event) => event.type === "exit_requested");
    expect(requested?.payload.reason).toMatchObject({ kind: "profit_target" });
  });

  it("marks open trades and records equity", async () => {
    const entered = await engine.enter(setup.id);
    if (!entered.ok) throw new Error("enter failed");
    enable();

    const outcome = await engine.automate(NOW);

    expect(outcome.marks).toBe(1);
    const marks = store.listMarks(entered.value.id);
    expect(marks).toHaveLength(1);
    expect(marks[0].liquidationValueUsd).toBeCloseTo(100);
    const equity = store.latestEquity();
    expect(equity?.positionsUsd).toBeCloseTo(100);
    expect(equity?.equityUsd).toBeCloseTo(99_979.2);
  });

  it("marks open trades from streamed option quotes and broadcasts updates", async () => {
    let listener: ((quote: Record<string, unknown>) => void) | null = null;
    let subscribed: string[] = [];
    const optionQuotes = {
      subscribe: (symbols: string[], next: (quote: Record<string, unknown>) => void) => {
        subscribed = [...symbols];
        listener = next;
      },
      unsubscribe: () => {
        listener = null;
      },
      streaming: () => true,
    };
    let chainCalls = 0;
    const market = {
      chain: async () => {
        chainCalls += 1;
        return chain();
      },
    } as unknown as ScannerMarketData;
    const liveEngine = new ExecutionEngine({
      store,
      broker: createPaperBroker({
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
      }),
      market,
      setups: {
        find: (id) => (id === setup.id ? setup : null),
        listEntryReady: () => entryCandidates,
      },
      optionQuotes,
      now: () => NOW,
    });

    const entered = await liveEngine.enter(setup.id);
    if (!entered.ok) throw new Error("enter failed");
    const chainCallsAfterEntry = chainCalls;
    expect(subscribed).toEqual([CONTRACT]);
    expect(listener).not.toBeNull();

    const events: string[] = [];
    const unsubscribe = liveEngine.subscribeMarks((event) => events.push(event.type));
    (listener as unknown as (quote: Record<string, unknown>) => void)({
      symbol: CONTRACT,
      bid: 1.4,
      ask: 1.5,
      quoteTime: 1_760_000_000,
      multiplier: 100,
      underlyingPrice: 101,
    });

    const status = await liveEngine.status();
    expect(status.latestMarks[entered.value.id]?.liquidationValueUsd).toBeCloseTo(140);
    expect(status.live).toMatchObject({ streaming: true, source: "stream" });
    expect(events).toContain("mark");
    // The first live mark persists immediately; later ticks are throttled.
    expect(store.listMarks(entered.value.id)).toHaveLength(1);

    enable();
    const outcome = await liveEngine.automate(NOW);
    expect(outcome.marks).toBe(1);
    expect(store.latestEquity()?.positionsUsd).toBeCloseTo(140);
    expect(chainCalls).toBe(chainCallsAfterEntry);

    unsubscribe();
    liveEngine.stop();
  });

  it("cancels pending paper trades on recovery and clears the lease", async () => {
    const trade = store.createTrade({
      id: "recover-1",
      opportunityId: "opp-recover",
      identityKey: "identity-recover",
      symbol: "AAPL",
      horizon: "swing",
      strategy: "long_call",
      setup: opportunity({ id: "opp-recover", identityKey: "identity-recover" }),
    });
    store.createOrder({
      clientOrderId: "recover-1:entry",
      tradeId: trade.id,
      intent: "entry",
      request: {
        clientOrderId: asClientOrderId("recover-1:entry"),
        intent: "open",
        assetClass: "option",
        instrument: { underlying: "AAPL", expiry: EXPIRY },
        legs: [{ contractSymbol: CONTRACT, side: "buy", quantity: 1 }],
        orderType: "limit",
        netLimitPrice: 1.2,
        timeInForce: "day",
      },
    });
    expect(store.acquireLease("other", 30_000)).toBe(true);

    expect(engine.recover(NOW)).toBe(1);

    expect(store.findTrade(trade.id)?.status).toBe("cancelled");
    expect(store.acquireLease("fresh", 30_000)).toBe(true);
    expect(engine.getTrade(trade.id)?.events.some((event) => event.type === "recovered_after_restart")).toBe(true);
  });

  it("does nothing while disabled or while the lease is held", async () => {
    expect((await engine.automate(NOW)).status).toBe("disabled");

    enable();
    expect(store.acquireLease("other", 30_000)).toBe(true);
    expect((await engine.automate(NOW)).status).toBe("overlap");
    store.releaseLease("other");
  });
});
