import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultScannerConfig } from "./config.js";
import { SCANNER_MIGRATIONS, ScannerStore } from "./store.js";
import type { OpportunityCandidate } from "./types.js";

let db: Database.Database;
let store: ScannerStore;

function candidate(identityKey: string, muteKey = "mute-a"): OpportunityCandidate {
  return {
    identityKey,
    muteKey,
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
      maxLossUsd: 201.75,
      feesUsd: 1.75,
      entryFeesUsd: 0.8,
      exitFeesUsd: 0.8,
      expiryFeesUsd: 0.15,
      netDebitUsd: 200,
      netCreditUsd: null,
      widthUsd: null,
      multiplier: 100,
      contracts: 1,
      slippageScenario: {
        label: "Illustrative 5% adverse premium scenario",
        netDebitUsd: 210,
        netCreditUsd: null,
        modeledLossUsd: 211.75,
        includedInRiskLimit: false,
      },
      assumptions: ["test"],
    },
    signal: {
      recipeId: "TREND-PULLBACK",
      recipeVersion: "1.0.0",
      horizon: "swing",
      direction: "bullish",
      signalBarTime: "2026-11-02T14:30:00.000Z",
      features: { emaFast: 1 },
      barsUsed: 80,
      source: "test",
    },
    thesis: "test thesis",
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
    earnings: { checked: true, nextEarningsDate: null },
    dataHealth: "current",
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  store = new ScannerStore(db);
});

afterEach(() => {
  db.close();
});

describe("scanner persistence", () => {
  it("deduplicates discovery identity and notifications", () => {
    const first = store.persistDiscovery(candidate("identity-a"), 1, null, "unavailable");
    const second = store.persistDiscovery(candidate("identity-a"), 2, null, "unavailable");
    expect(first.created).toBe(true);
    expect(first.notificationCreated).toBe(true);
    expect(second.created).toBe(false);
    expect(store.listOpportunities({ includeHistory: true })).toHaveLength(1);
    expect(store.notifications()).toHaveLength(1);
    expect(store.unreadCount()).toBe(1);
  });

  it("inherits dismissal across a revised contract identity with the same signal key", () => {
    const first = store.persistDiscovery(candidate("identity-a"), 1, null, "unavailable");
    store.dismiss(first.record.id);
    const changed = store.persistDiscovery(candidate("identity-b"), 1, null, "unavailable");
    expect(changed.created).toBe(true);
    expect(changed.record.dismissed).toBe(true);
    expect(changed.record.muted).toBe(true);
    expect(changed.notificationCreated).toBe(false);
    expect(store.notifications()).toHaveLength(1);
  });

  it("records checks and deduplicates target observations without terminating monitoring", () => {
    const record = store.persistDiscovery(candidate("identity-a"), 1, null, "unavailable").record;
    const check = {
      opportunityId: record.id,
      checkedAt: "2026-11-03T15:00:00.000Z",
      health: "current" as const,
      stateBefore: "entry_ready" as const,
      stateAfter: "entry_ready" as const,
      evidence: { price: 106 },
      note: "Target observation",
      events: [
        {
          type: "target_observed" as const,
          dedupeKey: `target:${record.id}:105`,
          payload: { hypothetical: true },
          notify: false,
        },
      ],
    };
    store.appendCheck(check);
    store.appendCheck({ ...check, checkedAt: "2026-11-03T15:05:00.000Z" });
    expect(store.checks(record.id)).toHaveLength(2);
    expect(store.events(record.id).filter((event) => event.type === "target_observed")).toHaveLength(1);
    expect(store.findById(record.id)?.state).toBe("entry_ready");
  });

  it("tracks watchlist revisions, conflicts, removals, and monitoring decisions", () => {
    const first = store.updateWatchlist(["AAPL", "MSFT"], 0, false);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.config.watchlist).toEqual(["AAPL", "MSFT"]);
    expect(store.updateWatchlist(["AAPL"], 0, false)).toMatchObject({ ok: false, conflict: true });
    const forced = store.updateWatchlist(["AAPL"], 0, true);
    expect(forced.ok).toBe(true);
    if (!forced.ok) return;
    expect(forced.removed).toEqual(["MSFT"]);

    const record = store.persistDiscovery(candidate("identity-a"), forced.config.revision, null, "unavailable").record;
    store.markRemovedSymbolsPending(["AAPL"]);
    expect(store.pendingWatchlistRemovals()).toEqual([{ symbol: "AAPL", opportunityIds: [record.id] }]);
    store.resolveWatchlistSymbol("AAPL", "archive");
    expect(store.findById(record.id)?.archived).toBe(true);
    expect(store.pendingWatchlistRemovals()).toHaveLength(0);
  });

  it("stores IV observations and reports only distinct-day ATM history", () => {
    for (let index = 0; index < 5; index++) {
      store.recordIvObservation({
        symbol: "AAPL",
        tenorDays: 30,
        moneyness: "ATM",
        observedAt: `2026-10-${String(20 + index).padStart(2, "0")}T15:00:00.000Z`,
        iv: 0.2 + index * 0.01,
        source: "test",
      });
    }
    store.recordIvObservation({
      symbol: "AAPL",
      tenorDays: 30,
      moneyness: "ATM",
      observedAt: "2026-10-24T18:00:00.000Z",
      iv: 0.24,
      source: "test",
    });
    const summary = store.ivSummary("AAPL", 60);
    expect(summary.observations).toBe(5);
    expect(summary.days).toBe(5);
    expect(summary.current).toBeCloseTo(0.24);
    expect(summary.percentile).toBe(100);
  });

  it("uses a database lease and recovers interrupted runs", () => {
    expect(store.acquireLease("one", 60_000)).toBe(true);
    expect(store.acquireLease("two", 60_000)).toBe(false);
    store.releaseLease("one");
    expect(store.acquireLease("two", 60_000)).toBe(true);

    const run = store.createRun("scheduled", 1);
    expect(store.recoverInterruptedRuns()).toBe(1);
    expect(store.recentRuns()[0].status).toBe("interrupted");
    expect(store.monitoringGaps()).toHaveLength(1);
    expect(store.recentRuns()[0].id).toBe(run);
    // Recovery drops the dead process's lease instead of blocking for its TTL.
    expect(store.acquireLease("three", 60_000)).toBe(true);
  });

  it("accepts the terminal missed state and emits its alert once", () => {
    const record = store.persistDiscovery(candidate("identity-missed"), 1, null, "unavailable").record;
    const check = {
      opportunityId: record.id,
      checkedAt: "2026-11-03T15:00:00.000Z",
      health: "current" as const,
      stateBefore: "watching" as const,
      stateAfter: "missed" as const,
      evidence: { price: 101, entry: 100.1 },
      note: "Entry missed",
      events: [
        {
          type: "missed" as const,
          dedupeKey: `missed:${record.id}`,
          payload: { price: 101 },
          notify: true,
        },
      ],
    };
    store.appendCheck(check);
    store.appendCheck({ ...check, checkedAt: "2026-11-03T15:05:00.000Z" });
    expect(store.findById(record.id)?.state).toBe("missed");
    expect(store.listActiveOpportunities()).toHaveLength(0);
    expect(store.notifications().filter((notification) => notification.type === "missed")).toHaveLength(1);
    expect(store.latestTerminalForFamily("TREND-PULLBACK", "AAPL", "swing", "bullish", "2026-11-01T00:00:00.000Z")?.id).toBe(
      record.id
    );
  });

  it("upgrades a version-1 database without losing history", () => {
    const legacy = new Database(":memory:");
    legacy.pragma("foreign_keys = ON");
    legacy.exec(
      "CREATE TABLE scanner_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
    );
    legacy.exec(SCANNER_MIGRATIONS[0].sql);
    legacy
      .prepare("INSERT INTO scanner_schema_migrations (version, applied_at) VALUES (1, ?)")
      .run("2026-11-01T00:00:00.000Z");
    legacy
      .prepare(
        `INSERT INTO scanner_opportunities (
           id, identity_key, mute_key, predecessor_id, symbol, horizon, strategy, direction,
           recipe_id, recipe_version, expiry, deadline, state, data_health, pinned, dismissed,
           muted, archived, watchlist_decision, config_revision, created_at, updated_at,
           last_checked_at, legs_json, risk_json, signal_json, conditions_json, thesis,
           earnings_json, current_evidence_json, ai_status
         ) VALUES (
           'legacy', 'legacy', 'legacy-mute', NULL, 'AAPL', 'swing', 'long_call', 'bullish',
           'TREND-PULLBACK', '1.0.0', '2026-11-20', '2026-11-20T14:30:00.000Z', 'watching',
           'current', 0, 0, 0, 0, 'monitor', 1, '2026-11-02T15:00:00.000Z',
           '2026-11-02T15:00:00.000Z', NULL, '[]', '{}', '{}', '{}', 't', '{}', NULL, 'unavailable'
         )`
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO scanner_opportunity_checks
           (opportunity_id, checked_at, health, state_before, state_after, evidence_json, note)
         VALUES ('legacy', '2026-11-02T15:05:00.000Z', 'current', 'watching', 'watching', '{}', 'kept')`
      )
      .run();

    const upgraded = new ScannerStore(legacy);
    expect(upgraded.findById("legacy")?.state).toBe("watching");
    expect(upgraded.checks("legacy")).toHaveLength(1);
    expect(upgraded.checks("legacy")[0].note).toBe("kept");

    upgraded.appendCheck({
      opportunityId: "legacy",
      checkedAt: "2026-11-02T15:10:00.000Z",
      health: "current",
      stateBefore: "watching",
      stateAfter: "missed",
      evidence: {},
      note: "Entry missed",
      events: [],
    });
    expect(upgraded.findById("legacy")?.state).toBe("missed");
    legacy.close();
  });

  it("starts with scanner disabled and no accepted configuration", () => {
    const config = store.getConfig();
    expect(config.enabled).toBe(false);
    expect(config.fees.confirmed).toBe(false);
    expect(config.recipes["TREND-PULLBACK"].enabled).toBe(false);
    expect(store.lastRun()).toBeNull();
  });
});
