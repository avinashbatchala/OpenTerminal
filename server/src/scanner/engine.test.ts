import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultScannerConfig } from "./config.js";
import { ScannerEngine } from "./engine.js";
import type { ScannerMarketData, NormalizedOption } from "./market.js";
import { ScannerStore } from "./store.js";
import type { AiAssessment, ScannerConfig } from "./types.js";
import { RECIPE_VERSION } from "./types.js";
import type { Bar } from "./indicators.js";

let db: Database.Database;
let store: ScannerStore;
let now: Date;
let price: number;

function readyConfig(): ScannerConfig {
  const config = defaultScannerConfig();
  config.enabled = true;
  config.watchlist = ["AAPL"];
  config.fees.confirmed = true;
  config.horizons.intraday.confirmed = true;
  config.horizons.swing.confirmed = true;
  config.quotes.confirmed = true;
  config.selection.confirmed = true;
  config.historyAssumptionAccepted = true;
  config.recipes["RANGE-BREAKOUT"] = {
    ...config.recipes["RANGE-BREAKOUT"],
    enabled: true,
    acceptedVersion: RECIPE_VERSION,
    paramsApproved: true,
  };
  return config;
}

function bars(): Bar[] {
  const start = Date.UTC(2026, 9, 1) / 1000;
  const rows: Bar[] = Array.from({ length: 27 }, (_, index) => ({
    time: start + index * 86_400,
    open: 98,
    high: 100,
    low: 95,
    close: 99,
    volume: 1000,
  }));
  rows[rows.length - 1] = {
    time: start + 26 * 86_400,
    open: 99,
    high: 101.5,
    low: 98.5,
    close: 101,
    volume: 2500,
  };
  return rows;
}

function option(strike: number, type: "call" | "put"): NormalizedOption {
  return {
    contractSymbol: `AAPL261120${type === "call" ? "C" : "P"}${String(strike * 1000).padStart(8, "0")}`,
    underlying: "AAPL",
    expiry: "2026-11-20",
    optionType: type,
    strike,
    bid: type === "call" ? Math.max(0.1, 2 - strike / 100) : Math.max(0.1, strike / 100 - 0.8),
    ask: type === "call" ? Math.max(0.2, 2.1 - strike / 100) : Math.max(0.2, strike / 100 - 0.7),
    volume: 1000,
    openInterest: 1000,
    impliedVolatility: 0.3,
    quoteTime: now.toISOString(),
    source: "test",
    multiplier: 100,
    deliverable: "100 shares",
    deliverableSource: "provider",
  };
}

function fakeMarket(): ScannerMarketData {
  return {
    quote: vi.fn(async () => ({
      symbol: "AAPL",
      price,
      bid: price - 0.01,
      ask: price + 0.01,
      quoteTime: now.toISOString(),
      source: "test",
      retrievedAt: now.toISOString(),
      marketState: "REGULAR",
    })),
    history: vi.fn(async () => ({
      symbol: "AAPL",
      horizon: "swing" as const,
      bars: bars(),
      intervalSeconds: 86_400,
      adjusted: false as const,
      source: "test",
      retrievedAt: now.toISOString(),
      issues: [],
    })),
    expirations: vi.fn(async () => ["2026-11-20"]),
    chain: vi.fn(async () => ({
      symbol: "AAPL",
      requestedExpiry: "2026-11-20",
      selectedDate: "2026-11-20",
      underlyingPrice: price,
      expirationDates: ["2026-11-20"],
      calls: [96, 98, 100, 102, 104, 106].map((strike) => option(strike, "call")),
      puts: [94, 96, 98, 100].map((strike) => option(strike, "put")),
      retrievedAt: now.toISOString(),
      source: "test",
      issues: [],
    })),
    earnings: vi.fn(async () => ({ AAPL: { nextEarningsDate: null } })),
  };
}

function assessment(opportunityId = "x"): AiAssessment {
  return {
    opportunityId,
    candidateHash: "hash",
    model: "test",
    promptVersion: "test",
    schemaVersion: "1",
    status: "ready",
    output: {
      summary: "ok",
      thesis: "ok",
      risks: ["risk"],
      rank: 50,
      confidence: "medium",
    },
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUsd: null,
    pricingSource: null,
    error: null,
    createdAt: now.toISOString(),
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  store = new ScannerStore(db);
  now = new Date("2026-11-02T15:00:00Z");
  price = 100;
});

afterEach(() => {
  db.close();
});

describe("scanner engine", () => {
  it("refuses to scan when disabled or unconfigured", async () => {
    const engine = new ScannerEngine({
      store,
      market: fakeMarket(),
      now: () => now,
      assess: vi.fn(async (candidate: any) => assessment(candidate.identityKey)),
    });
    await expect(engine.runScan("scheduled")).resolves.toEqual({ status: "disabled" });
    store.saveConfig({ ...defaultScannerConfig(), enabled: true });
    await expect(engine.runScan("scheduled")).resolves.toEqual({ status: "configuration" });
  });

  it("discovers, monitors, enters, observes targets, invalidates, and deduplicates alerts", async () => {
    const config = readyConfig();
    store.saveConfig(config, true);
    const market = fakeMarket();
    const assess = vi.fn(async (candidate: any) => assessment(candidate.identityKey));
    const engine = new ScannerEngine({ store, market, now: () => now, assess });

    const first = await engine.runScan("scheduled");
    expect(first.status).toBe("completed");
    expect(first.qualified).toBe(2);
    const active = store.listActiveOpportunities();
    expect(active).toHaveLength(2);
    expect(store.notifications()).toHaveLength(2);
    expect(assess).toHaveBeenCalledTimes(2);

    const second = await engine.runScan("scheduled");
    expect(second.status).toBe("completed");
    expect(store.listActiveOpportunities()).toHaveLength(2);
    expect(store.notifications()).toHaveLength(2);

    price = 100.2;
    now = new Date("2026-11-02T15:05:00Z");
    await engine.runScan("scheduled");
    expect(store.listActiveOpportunities().every((opportunity) => opportunity.state === "entry_ready")).toBe(true);
    expect(store.notifications().filter((notification) => notification.type === "entry_ready")).toHaveLength(2);

    price = 111;
    now = new Date("2026-11-02T15:10:00Z");
    await engine.runScan("scheduled");
    const targetEvents = store
      .listActiveOpportunities()
      .flatMap((opportunity) => store.events(opportunity.id))
      .filter((event) => event.type === "target_observed");
    expect(targetEvents).toHaveLength(2);
    expect(store.notifications().filter((notification) => notification.type === "target_observed")).toHaveLength(0);

    price = 94;
    now = new Date("2026-11-02T15:15:00Z");
    await engine.runScan("scheduled");
    expect(store.listActiveOpportunities()).toHaveLength(0);
    const invalidated = store
      .listOpportunities({ includeHistory: true })
      .filter((opportunity) => opportunity.state === "invalidated");
    expect(invalidated).toHaveLength(2);
    expect(store.notifications().filter((notification) => notification.type === "invalidated")).toHaveLength(2);
  });

  it("marks an entry as missed when price leaves the chase band before entry", async () => {
    const config = readyConfig();
    store.saveConfig(config, true);
    const market = fakeMarket();
    const engine = new ScannerEngine({
      store,
      market,
      now: () => now,
      assess: vi.fn(async (candidate: any) => assessment(candidate.identityKey)),
    });
    await engine.runScan("scheduled");
    expect(store.listActiveOpportunities()).toHaveLength(2);

    // Entry is ~100.10 with a 0.35% chase band; 101 is beyond it.
    price = 101;
    now = new Date("2026-11-02T15:05:00Z");
    await engine.runScan("scheduled");

    expect(store.listActiveOpportunities()).toHaveLength(0);
    const missed = store
      .listOpportunities({ includeHistory: true })
      .filter((opportunity) => opportunity.state === "missed");
    expect(missed).toHaveLength(2);
    expect(store.notifications().filter((notification) => notification.type === "missed")).toHaveLength(2);
    expect(store.checks(missed[0].id).at(-1)?.note).toContain("Entry missed");
  });

  it("runs a quote-only monitoring pass between scans and only fetches chains in band", async () => {
    const config = readyConfig();
    store.saveConfig(config, true);
    const market = fakeMarket();
    const engine = new ScannerEngine({
      store,
      market,
      now: () => now,
      assess: vi.fn(async (candidate: any) => assessment(candidate.identityKey)),
    });
    await engine.runScan("scheduled");

    const chainMock = vi.mocked(market.chain);
    chainMock.mockClear();

    // Outside the entry band: no chain fetch, state unchanged, no notification.
    price = 100;
    now = new Date("2026-11-02T15:00:30Z");
    await engine.runMonitoring(now);
    expect(chainMock).not.toHaveBeenCalled();
    expect(store.listActiveOpportunities().every((opportunity) => opportunity.state === "watching")).toBe(true);

    // Inside the band: fetch the chain, verify the legs, transition once.
    price = 100.2;
    now = new Date("2026-11-02T15:01:00Z");
    const outcome = await engine.runMonitoring(now);
    expect(outcome.status).toBe("completed");
    expect(chainMock).toHaveBeenCalledTimes(1);
    expect(store.listActiveOpportunities().every((opportunity) => opportunity.state === "entry_ready")).toBe(true);
    expect(store.notifications().filter((notification) => notification.type === "entry_ready")).toHaveLength(2);

    // Routine checks are throttled, so a second pass within five minutes adds nothing.
    const first = store.listActiveOpportunities()[0];
    const before = store.checks(first.id).length;
    now = new Date("2026-11-02T15:01:30Z");
    await engine.runMonitoring(now);
    expect(store.checks(first.id)).toHaveLength(before);
  });

  it("permits only one overlapping run through the database lease", async () => {
    const config = readyConfig();
    store.saveConfig(config, true);
    const base = fakeMarket();
    const slow = {
      ...base,
      quote: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return base.quote("AAPL");
      }),
    };
    const engine = new ScannerEngine({
      store,
      market: slow,
      now: () => now,
      assess: vi.fn(async (candidate: any) => assessment(candidate.identityKey)),
    });
    const outcomes = await Promise.all([engine.runScan("scheduled"), engine.runScan("scheduled")]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["completed", "overlap"]);
  });

  it("discards a run when configuration changes before commit", async () => {
    const config = readyConfig();
    store.saveConfig(config, true);
    const base = fakeMarket();
    const changed = {
      ...base,
      quote: vi.fn(async () => {
        const current = store.getConfig();
        store.saveConfig({ ...current, revision: current.revision + 1, enabled: true }, true);
        return base.quote("AAPL");
      }),
    };
    const engine = new ScannerEngine({
      store,
      market: changed,
      now: () => now,
      assess: vi.fn(async (candidate: any) => assessment(candidate.identityKey)),
    });
    const result = await engine.runScan("scheduled");
    expect(result.status).toBe("obsolete");
    expect(store.listActiveOpportunities()).toHaveLength(0);
    expect(store.lastRun()?.status).toBe("obsolete");
  });

  it("expires setup deadlines during restart recovery without inventing market events", () => {
    const config = readyConfig();
    store.saveConfig(config, true);
    const record = store.persistDiscovery(
      {
        identityKey: "identity-expiry",
        muteKey: "mute-expiry",
        symbol: "AAPL",
        horizon: "swing",
        strategy: "long_call",
        direction: "bullish",
        recipeId: "TREND-PULLBACK",
        recipeVersion: "1.0.0",
        expiry: "2026-11-20",
        deadline: "2026-11-20T14:30:00.000Z",
        legs: [],
        risk: {
          maxLossUsd: 100,
          feesUsd: 1,
          entryFeesUsd: 0.5,
          exitFeesUsd: 0.5,
          expiryFeesUsd: 0,
          netDebitUsd: 99,
          netCreditUsd: null,
          widthUsd: null,
          multiplier: 100,
          contracts: 1,
          slippageScenario: {
            label: "scenario",
            netDebitUsd: 100,
            netCreditUsd: null,
            modeledLossUsd: 101,
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
        thesis: "thesis",
        conditions: {
          entry: "entry",
          invalidation: "invalidation",
          target: null,
          deadline: "2026-11-20T14:30:00.000Z",
          levels: {
            entry: 101,
            invalidation: 95,
            target: null,
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
        earnings: { checked: true, nextEarningsDate: null },
        dataHealth: "current",
      },
      1,
      null,
      "unavailable"
    ).record;
    const engine = new ScannerEngine({
      store,
      market: fakeMarket(),
      now: () => new Date("2026-11-20T14:31:00.000Z"),
      assess: vi.fn(async (candidate: any) => assessment(candidate.identityKey)),
    });
    expect(engine.recoverAfterRestart().expired).toBe(1);
    expect(store.findById(record.id)?.state).toBe("expired");
    expect(store.checks(record.id)[0].note).toContain("Expired");
    expect(store.events(record.id).filter((event) => event.type === "invalidated")).toHaveLength(0);
  });

  it("preserves inability to assess when monitoring data is stale", async () => {
    const config = readyConfig();
    store.saveConfig(config, true);
    const market = fakeMarket();
    const engine = new ScannerEngine({ store, market, now: () => now, assess: vi.fn(async (candidate: any) => assessment(candidate.identityKey)) });
    await engine.runScan("scheduled");
    const active = store.listActiveOpportunities();
    const staleQuote = vi.fn(async () => ({
      symbol: "AAPL",
      price,
      bid: price - 0.01,
      ask: price + 0.01,
      quoteTime: "2026-11-02T14:00:00.000Z",
      source: "test",
      retrievedAt: now.toISOString(),
      marketState: "REGULAR",
    }));
    market.quote = staleQuote;
    now = new Date("2026-11-02T15:05:00Z");
    await engine.runScan("scheduled");
    const unchanged = store.listActiveOpportunities();
    expect(unchanged.map((opportunity) => opportunity.id)).toEqual(active.map((opportunity) => opportunity.id));
    expect(unchanged.every((opportunity) => opportunity.currentHealth === "stale")).toBe(true);
  });
});
