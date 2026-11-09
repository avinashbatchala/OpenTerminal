import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpportunityRecord } from "../scanner/types.js";
import { asBrokerOrderId, asClientOrderId } from "./ports/broker.js";
import { createExecutionStore, type ExecutionStore } from "./store.js";

let db: Database.Database;
let store: ExecutionStore;

function setup(overrides: Partial<OpportunityRecord> = {}): OpportunityRecord {
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
    updatedAt: "2026-11-02T15:00:00.000Z",
    lastCheckedAt: "2026-11-02T15:00:00.000Z",
    legs: [],
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
    aiStatus: "ready",
    ...overrides,
  };
}

const REQUEST = {
  clientOrderId: asClientOrderId("trade-1:entry"),
  intent: "open" as const,
  assetClass: "option" as const,
  instrument: { underlying: "AAPL", expiry: "2026-11-20" },
  legs: [{ contractSymbol: "AAPL261120C00100000", side: "buy" as const, quantity: 1 }],
  orderType: "limit" as const,
  netLimitPrice: 1.206,
  timeInForce: "day" as const,
};

beforeEach(() => {
  db = new Database(":memory:");
  store = createExecutionStore(db);
});

afterEach(() => {
  db.close();
});

describe("execution persistence", () => {
  it("seeds and persists execution config", () => {
    const initial = store.getConfig();
    expect(initial.enabled).toBe(false);
    expect(initial.startingCashUsd).toBe(100_000);

    const saved = store.saveConfig({ ...initial, startingCashUsd: 50_000 });
    expect(saved.startingCashUsd).toBe(50_000);
    expect(store.getConfig().startingCashUsd).toBe(50_000);
  });

  it("stores trades, orders, fills and events", () => {
    const trade = store.createTrade({
      id: "trade-1",
      opportunityId: "opp-1",
      identityKey: "identity-1",
      symbol: "AAPL",
      horizon: "swing",
      strategy: "long_call",
      setup: setup(),
    });
    expect(trade.status).toBe("pending_entry");

    const order = store.createOrder({
      clientOrderId: REQUEST.clientOrderId,
      tradeId: trade.id,
      intent: "entry",
      request: REQUEST,
    });
    expect(order.status).toBe("submitted");
    expect(order.state.status).toBe("submitted");

    const updated = store.updateTrade(trade.id, { status: "open", entryOrderId: order.clientOrderId });
    expect(updated.status).toBe("open");
    expect(store.listOpenTrades()).toHaveLength(1);

    const fills = [
      {
        fillId: "fill-1",
        clientOrderId: order.clientOrderId,
        tradeId: trade.id,
        contractSymbol: "AAPL261120C00100000",
        side: "buy" as const,
        quantity: 1,
        price: 1.2,
        referenceMid: 1.1,
        multiplier: 100,
        slippageUsd: 10,
        feesUsd: 0.8,
        filledAt: "2026-11-09T15:00:00.000Z",
      },
    ];
    expect(store.insertFills(fills)).toBe(1);
    expect(store.insertFills(fills)).toBe(0);
    expect(store.listFills(trade.id)).toHaveLength(1);
    expect(store.listAllFills()).toHaveLength(1);

    expect(
      store.appendEvent({
        tradeId: trade.id,
        type: "trade_opened",
        dedupeKey: "trade:trade-1:opened",
        payload: {},
      })
    ).toBe(true);
    expect(
      store.appendEvent({
        tradeId: trade.id,
        type: "trade_opened",
        dedupeKey: "trade:trade-1:opened",
        payload: {},
      })
    ).toBe(false);

    expect(store.counts().open).toBe(1);
    expect(store.findByOpportunity("opp-1")?.id).toBe(trade.id);
  });

  it("stores the full order state and broker id", () => {
    const trade = store.createTrade({
      id: "trade-2",
      opportunityId: "opp-2",
      identityKey: "identity-2",
      symbol: "AAPL",
      horizon: "swing",
      strategy: "long_call",
      setup: setup({ id: "opp-2", identityKey: "identity-2" }),
    });
    const order = store.createOrder({
      clientOrderId: REQUEST.clientOrderId,
      tradeId: trade.id,
      intent: "entry",
      request: REQUEST,
    });

    const acknowledged = store.updateOrder(order.clientOrderId, {
      brokerOrderId: "broker-1",
      status: "acknowledged",
      state: {
        status: "acknowledged",
        request: REQUEST,
        brokerOrderId: asBrokerOrderId("broker-1"),
        fills: [],
        submittedAt: order.createdAt,
        at: order.createdAt,
      },
    });

    expect(acknowledged.brokerOrderId).toBe("broker-1");
    expect(acknowledged.state.status).toBe("acknowledged");
  });

  it("arbitrates the execution lease", () => {
    expect(store.acquireLease("one", 30_000)).toBe(true);
    expect(store.acquireLease("two", 30_000)).toBe(false);
    store.releaseLease("one");
    expect(store.acquireLease("two", 30_000)).toBe(true);
  });

  it("records marks, equity snapshots and clears the lease", () => {
    const trade = store.createTrade({
      id: "trade-marks",
      opportunityId: "opp-marks",
      identityKey: "identity-marks",
      symbol: "AAPL",
      horizon: "swing",
      strategy: "long_call",
      setup: setup({ id: "opp-marks", identityKey: "identity-marks" }),
    });

    store.recordMark({
      tradeId: trade.id,
      markedAt: "2026-11-09T15:00:00.000Z",
      liquidationValueUsd: 100,
      underlyingPrice: 101,
    });
    expect(store.listMarks(trade.id)).toEqual([
      {
        tradeId: trade.id,
        markedAt: "2026-11-09T15:00:00.000Z",
        liquidationValueUsd: 100,
        underlyingPrice: 101,
      },
    ]);

    store.recordEquity({
      asOf: "2026-11-09T15:00:00.000Z",
      cashUsd: 99_000,
      positionsUsd: 1_000,
      equityUsd: 100_000,
    });
    expect(store.latestEquity()).toEqual({
      asOf: "2026-11-09T15:00:00.000Z",
      cashUsd: 99_000,
      positionsUsd: 1_000,
      equityUsd: 100_000,
    });
    expect(store.equityHistory()).toHaveLength(1);

    store.recordEquity({
      asOf: "2026-11-09T15:10:00.000Z",
      cashUsd: 100_000,
      positionsUsd: 91,
      equityUsd: 100_091,
    });
    expect(store.deleteResetEquitySnapshots(100_000)).toBe(1);
    expect(store.latestEquity()?.equityUsd).toBe(100_000);

    expect(store.acquireLease("one", 30_000)).toBe(true);
    store.clearLease();
    expect(store.acquireLease("two", 30_000)).toBe(true);
  });
});
