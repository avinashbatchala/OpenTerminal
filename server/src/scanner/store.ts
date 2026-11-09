import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { db as defaultDb } from "../db.js";
import { defaultScannerConfig, normalizeScannerConfig } from "./config.js";
import type {
  AiAssessment,
  DataHealth,
  Horizon,
  OpportunityCandidate,
  OpportunityCheck,
  OpportunityRecord,
  OpportunityState,
  RecipeId,
  ScanCoverage,
  ScanRun,
  ScannerConfig,
  ScannerEvent,
  ScannerNotification,
  WatchlistDecision,
} from "./types.js";

export type OpportunityFilters = {
  horizon?: Horizon;
  state?: OpportunityState;
  recipeId?: RecipeId;
  strategy?: string;
  pinned?: boolean;
  dismissed?: boolean;
  includeHistory?: boolean;
  limit?: number;
};

export type DiscoveryResult = {
  created: boolean;
  record: OpportunityRecord;
  notificationCreated: boolean;
};

export type CheckEventInput = {
  type: ScannerEvent["type"];
  dedupeKey: string;
  payload: Record<string, unknown>;
  notify: boolean;
};

export type CheckInput = {
  opportunityId: string;
  checkedAt: string;
  health: DataHealth;
  stateBefore: OpportunityState;
  stateAfter: OpportunityState;
  evidence: Record<string, unknown>;
  note: string | null;
  events: CheckEventInput[];
};

export type RunPatch = {
  status: ScanRun["status"];
  coverage?: ScanCoverage[];
  failures?: string[];
  candidates?: number;
  qualified?: number;
  error?: string | null;
};

export type IvObservation = {
  symbol: string;
  tenorDays: number;
  moneyness: string;
  observedAt: string;
  iv: number;
  source: string;
};

export type IvSummary = {
  observations: number;
  days: number;
  current: number | null;
  percentile: number | null;
  latestAt: string | null;
};

type ScannerMigration = { version: number; sql: string; foreignKeysOff?: boolean };

export const SCANNER_MIGRATIONS: ScannerMigration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE scanner_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  watchlist_revision INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  accepted_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE scanner_scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed','interrupted','obsolete','market_closed')),
  trigger TEXT NOT NULL CHECK (trigger IN ('scheduled','recovery','manual')),
  config_revision INTEGER NOT NULL,
  coverage_json TEXT NOT NULL DEFAULT '[]',
  failures_json TEXT NOT NULL DEFAULT '[]',
  candidates INTEGER NOT NULL DEFAULT 0,
  qualified INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX scanner_scan_runs_started_idx ON scanner_scan_runs(started_at DESC);

CREATE TABLE scanner_monitoring_gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  reason TEXT NOT NULL
);

CREATE TABLE scanner_opportunities (
  id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL UNIQUE,
  mute_key TEXT NOT NULL,
  predecessor_id TEXT REFERENCES scanner_opportunities(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  horizon TEXT NOT NULL CHECK (horizon IN ('intraday','swing')),
  strategy TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('bullish','bearish','neutral')),
  recipe_id TEXT NOT NULL,
  recipe_version TEXT NOT NULL,
  expiry TEXT NOT NULL,
  deadline TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('watching','entry_ready','invalidated','expired')),
  data_health TEXT NOT NULL CHECK (data_health IN ('current','stale','unable')),
  pinned INTEGER NOT NULL DEFAULT 0,
  dismissed INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  watchlist_decision TEXT NOT NULL DEFAULT 'monitor' CHECK (watchlist_decision IN ('monitor','archive','pending')),
  config_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_checked_at TEXT,
  legs_json TEXT NOT NULL,
  risk_json TEXT NOT NULL,
  signal_json TEXT NOT NULL,
  conditions_json TEXT NOT NULL,
  thesis TEXT NOT NULL,
  earnings_json TEXT NOT NULL,
  current_evidence_json TEXT,
  ai_status TEXT NOT NULL DEFAULT 'pending' CHECK (ai_status IN ('pending','ready','failed','unavailable'))
);
CREATE INDEX scanner_opportunities_symbol_idx ON scanner_opportunities(symbol, created_at DESC);
CREATE INDEX scanner_opportunities_horizon_state_idx ON scanner_opportunities(horizon, state, created_at DESC);
CREATE INDEX scanner_opportunities_mute_idx ON scanner_opportunities(mute_key, created_at DESC);
CREATE INDEX scanner_opportunities_deadline_idx ON scanner_opportunities(deadline);

CREATE TABLE scanner_opportunity_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id TEXT NOT NULL REFERENCES scanner_opportunities(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL,
  health TEXT NOT NULL CHECK (health IN ('current','stale','unable')),
  state_before TEXT NOT NULL,
  state_after TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  note TEXT
);
CREATE INDEX scanner_checks_opportunity_idx ON scanner_opportunity_checks(opportunity_id, checked_at DESC);

CREATE TABLE scanner_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id TEXT NOT NULL REFERENCES scanner_opportunities(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX scanner_events_opportunity_idx ON scanner_events(opportunity_id, created_at DESC);

CREATE TABLE scanner_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL UNIQUE REFERENCES scanner_events(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL REFERENCES scanner_opportunities(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX scanner_notifications_unread_idx ON scanner_notifications(read_at, created_at DESC);

CREATE TABLE scanner_ai_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id TEXT NOT NULL REFERENCES scanner_opportunities(id) ON DELETE CASCADE,
  candidate_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready','failed','unavailable')),
  output_json TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  estimated_cost_usd REAL,
  pricing_source TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (opportunity_id, candidate_hash)
);
CREATE INDEX scanner_ai_assessments_usage_idx ON scanner_ai_assessments(created_at DESC);

CREATE TABLE scanner_iv_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  tenor_days INTEGER NOT NULL,
  moneyness TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  observation_date TEXT NOT NULL,
  iv REAL NOT NULL,
  source TEXT NOT NULL,
  UNIQUE (symbol, tenor_days, moneyness, observation_date, source)
);
CREATE INDEX scanner_iv_history_idx ON scanner_iv_observations(symbol, observed_at DESC);

CREATE TABLE scanner_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`,
  },
  {
    // SQLite cannot alter a CHECK constraint in place. Add the terminal "missed"
    // state by rebuilding the table; foreign keys must be off so the child
    // tables are not cascade-deleted while the parent is replaced.
    version: 2,
    foreignKeysOff: true,
    sql: `
ALTER TABLE scanner_opportunities RENAME TO scanner_opportunities_v1;

CREATE TABLE scanner_opportunities (
  id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL UNIQUE,
  mute_key TEXT NOT NULL,
  predecessor_id TEXT REFERENCES scanner_opportunities(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  horizon TEXT NOT NULL CHECK (horizon IN ('intraday','swing')),
  strategy TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('bullish','bearish','neutral')),
  recipe_id TEXT NOT NULL,
  recipe_version TEXT NOT NULL,
  expiry TEXT NOT NULL,
  deadline TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('watching','entry_ready','invalidated','expired','missed')),
  data_health TEXT NOT NULL CHECK (data_health IN ('current','stale','unable')),
  pinned INTEGER NOT NULL DEFAULT 0,
  dismissed INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  watchlist_decision TEXT NOT NULL DEFAULT 'monitor' CHECK (watchlist_decision IN ('monitor','archive','pending')),
  config_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_checked_at TEXT,
  legs_json TEXT NOT NULL,
  risk_json TEXT NOT NULL,
  signal_json TEXT NOT NULL,
  conditions_json TEXT NOT NULL,
  thesis TEXT NOT NULL,
  earnings_json TEXT NOT NULL,
  current_evidence_json TEXT,
  ai_status TEXT NOT NULL DEFAULT 'pending' CHECK (ai_status IN ('pending','ready','failed','unavailable'))
);

INSERT INTO scanner_opportunities (
  id, identity_key, mute_key, predecessor_id, symbol, horizon, strategy, direction, recipe_id,
  recipe_version, expiry, deadline, state, data_health, pinned, dismissed, muted, archived,
  watchlist_decision, config_revision, created_at, updated_at, last_checked_at, legs_json, risk_json,
  signal_json, conditions_json, thesis, earnings_json, current_evidence_json, ai_status
)
SELECT
  id, identity_key, mute_key, predecessor_id, symbol, horizon, strategy, direction, recipe_id,
  recipe_version, expiry, deadline, state, data_health, pinned, dismissed, muted, archived,
  watchlist_decision, config_revision, created_at, updated_at, last_checked_at, legs_json, risk_json,
  signal_json, conditions_json, thesis, earnings_json, current_evidence_json, ai_status
FROM scanner_opportunities_v1;

DROP TABLE scanner_opportunities_v1;

CREATE INDEX scanner_opportunities_symbol_idx ON scanner_opportunities(symbol, created_at DESC);
CREATE INDEX scanner_opportunities_horizon_state_idx ON scanner_opportunities(horizon, state, created_at DESC);
CREATE INDEX scanner_opportunities_mute_idx ON scanner_opportunities(mute_key, created_at DESC);
CREATE INDEX scanner_opportunities_deadline_idx ON scanner_opportunities(deadline);
`,
  },
];

function applyMigration(database: Database.Database, migration: ScannerMigration) {
  const record = () =>
    database
      .prepare("INSERT INTO scanner_schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(migration.version, new Date().toISOString());

  if (!migration.foreignKeysOff) {
    database.transaction(() => {
      database.exec(migration.sql);
      record();
    })();
    return;
  }

  // PRAGMA foreign_keys is a no-op inside a transaction, so toggle it around it.
  // legacy_alter_table keeps the rename from rewriting child REFERENCES clauses.
  database.pragma("foreign_keys = OFF");
  database.pragma("legacy_alter_table = ON");
  try {
    database.transaction(() => {
      database.exec(migration.sql);
      const violations = database.pragma("foreign_key_check") as unknown[];
      if (Array.isArray(violations) && violations.length > 0) {
        throw new Error(
          `scanner migration ${migration.version} left ${violations.length} foreign-key violation(s)`
        );
      }
      record();
    })();
  } finally {
    database.pragma("legacy_alter_table = OFF");
    database.pragma("foreign_keys = ON");
  }
}

function migrate(database: Database.Database) {
  database.exec(
    "CREATE TABLE IF NOT EXISTS scanner_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
  );
  for (const migration of SCANNER_MIGRATIONS) {
    const exists = database
      .prepare("SELECT version FROM scanner_schema_migrations WHERE version = ?")
      .get(migration.version);
    if (exists) continue;
    applyMigration(database, migration);
  }
}

function json<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapOpportunity(row: any): OpportunityRecord {
  return {
    id: row.id,
    identityKey: row.identity_key,
    muteKey: row.mute_key,
    predecessorId: row.predecessor_id ?? null,
    symbol: row.symbol,
    horizon: row.horizon,
    strategy: row.strategy,
    direction: row.direction,
    recipeId: row.recipe_id,
    recipeVersion: row.recipe_version,
    expiry: row.expiry,
    deadline: row.deadline,
    state: row.state,
    dataHealth: row.data_health,
    pinned: Boolean(row.pinned),
    dismissed: Boolean(row.dismissed),
    muted: Boolean(row.muted),
    archived: Boolean(row.archived),
    watchlistDecision: row.watchlist_decision,
    configRevision: row.config_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckedAt: row.last_checked_at ?? null,
    legs: json(row.legs_json, []),
    risk: json(row.risk_json, {}),
    signal: json(row.signal_json, {}),
    conditions: json(row.conditions_json, {}),
    thesis: row.thesis,
    earnings: json(row.earnings_json, { checked: false, nextEarningsDate: null }),
    currentHealth: row.data_health,
    currentEvidence: row.current_evidence_json
      ? json(row.current_evidence_json, null)
      : null,
    aiStatus: row.ai_status,
  } as unknown as OpportunityRecord;
}

function mapRun(row: any): ScanRun {
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? null,
    status: row.status,
    trigger: row.trigger,
    configRevision: row.config_revision,
    coverage: json(row.coverage_json, []),
    failures: json(row.failures_json, []),
    candidates: row.candidates,
    qualified: row.qualified,
    error: row.error ?? null,
  };
}

export class ScannerStore {
  constructor(private readonly database: Database.Database = defaultDb) {
    migrate(database);
    const existing = database.prepare("SELECT id FROM scanner_config WHERE id = 1").get();
    if (!existing) {
      const config = defaultScannerConfig();
      database
        .prepare(
          `INSERT INTO scanner_config
            (id, revision, enabled, watchlist_revision, config_json, accepted_at, updated_at)
           VALUES (1, ?, 0, ?, ?, NULL, ?)`
        )
        .run(config.revision, config.watchlistRevision, JSON.stringify(config), nowIso());
    }
  }

  getConfig(): ScannerConfig {
    const row = this.database
      .prepare("SELECT config_json FROM scanner_config WHERE id = 1")
      .get() as { config_json: string } | undefined;
    return row ? normalizeScannerConfig(json(row.config_json, defaultScannerConfig())) : defaultScannerConfig();
  }

  saveConfig(config: ScannerConfig, accepted = false): ScannerConfig {
    const next = normalizeScannerConfig(config);
    const updatedAt = nowIso();
    this.database
      .prepare(
        `UPDATE scanner_config
         SET revision = ?, enabled = ?, watchlist_revision = ?, config_json = ?, accepted_at = ?, updated_at = ?
         WHERE id = 1`
      )
      .run(
        next.revision,
        next.enabled ? 1 : 0,
        next.watchlistRevision,
        JSON.stringify({ ...next, updatedAt }),
        accepted ? updatedAt : null,
        updatedAt
      );
    return { ...next, updatedAt };
  }

  nextConfigRevision(config: ScannerConfig): ScannerConfig {
    return { ...config, revision: config.revision + 1 };
  }

  updateWatchlist(
    symbols: string[],
    baseRevision: number | null,
    force: boolean
  ): { ok: true; config: ScannerConfig; removed: string[]; added: string[] } | { ok: false; conflict: true; current: string[]; revision: number } {
    const config = this.getConfig();
    if (!force && baseRevision !== null && baseRevision !== config.watchlistRevision) {
      return {
        ok: false,
        conflict: true,
        current: config.watchlist,
        revision: config.watchlistRevision,
      };
    }
    const nextSymbols = Array.from(
      new Set(
        symbols
          .map((symbol) => symbol.trim().toUpperCase())
          .filter((symbol) => /^[A-Z0-9.^=-]{1,20}$/.test(symbol))
      )
    ).slice(0, config.maxWatchlistSymbols);
    const removed = config.watchlist.filter((symbol) => !nextSymbols.includes(symbol));
    const added = nextSymbols.filter((symbol) => !config.watchlist.includes(symbol));
    const next = normalizeScannerConfig({
      ...config,
      revision: config.revision + 1,
      watchlist: nextSymbols,
      watchlistRevision: config.watchlistRevision + 1,
    });
    this.saveConfig(next);
    return { ok: true, config: next, removed, added };
  }

  acquireLease(owner: string, ttlMs: number): boolean {
    const now = Date.now();
    const result = this.database
      .prepare(
        `INSERT INTO scanner_lease (id, owner, expires_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
         WHERE scanner_lease.expires_at <= ? OR scanner_lease.owner = excluded.owner`
      )
      .run(owner, now + ttlMs, now);
    return result.changes > 0;
  }

  releaseLease(owner: string): void {
    this.database.prepare("DELETE FROM scanner_lease WHERE id = 1 AND owner = ?").run(owner);
  }

  createRun(trigger: ScanRun["trigger"], configRevision: number): number {
    const result = this.database
      .prepare(
        "INSERT INTO scanner_scan_runs (started_at, status, trigger, config_revision) VALUES (?, 'running', ?, ?)"
      )
      .run(nowIso(), trigger, configRevision);
    return Number(result.lastInsertRowid);
  }

  finishRun(id: number, patch: RunPatch): void {
    this.database
      .prepare(
        `UPDATE scanner_scan_runs
         SET finished_at = ?, status = ?, coverage_json = ?, failures_json = ?, candidates = ?, qualified = ?, error = ?
         WHERE id = ?`
      )
      .run(
        nowIso(),
        patch.status,
        JSON.stringify(patch.coverage ?? []),
        JSON.stringify(patch.failures ?? []),
        patch.candidates ?? 0,
        patch.qualified ?? 0,
        patch.error ?? null,
        id
      );
  }

  lastRun(): ScanRun | null {
    const row = this.database
      .prepare("SELECT * FROM scanner_scan_runs ORDER BY id DESC LIMIT 1")
      .get();
    return row ? mapRun(row) : null;
  }

  lastCompletedRun(): ScanRun | null {
    const row = this.database
      .prepare("SELECT * FROM scanner_scan_runs WHERE status IN ('completed','market_closed') ORDER BY id DESC LIMIT 1")
      .get();
    return row ? mapRun(row) : null;
  }

  recentRuns(limit = 20): ScanRun[] {
    return (this.database
      .prepare("SELECT * FROM scanner_scan_runs ORDER BY id DESC LIMIT ?")
      .all(limit) as any[]).map(mapRun);
  }

  recoverInterruptedRuns(): number {
    const rows = this.database
      .prepare("SELECT id, started_at FROM scanner_scan_runs WHERE status = 'running'")
      .all() as Array<{ id: number; started_at: string }>;
    if (rows.length === 0) return 0;
    const endedAt = nowIso();
    const transaction = this.database.transaction(() => {
      for (const row of rows) {
        this.database
          .prepare(
            "UPDATE scanner_scan_runs SET status = 'interrupted', finished_at = ?, error = ? WHERE id = ?"
          )
          .run(endedAt, "API process restarted before the run completed", row.id);
        this.database
          .prepare(
            "INSERT INTO scanner_monitoring_gaps (started_at, ended_at, reason) VALUES (?, ?, ?)"
          )
          .run(row.started_at, endedAt, "Interrupted scan run recovered after restart");
      }
      // A restart means no process owns the run that was in flight; drop its
      // lease immediately instead of waiting for the TTL to expire.
      this.database.prepare("DELETE FROM scanner_lease").run();
    });
    transaction();
    return rows.length;
  }

  recordMonitoringGap(startedAt: string, endedAt: string, reason: string): void {
    this.database
      .prepare("INSERT INTO scanner_monitoring_gaps (started_at, ended_at, reason) VALUES (?, ?, ?)")
      .run(startedAt, endedAt, reason);
  }

  monitoringGaps(limit = 10): Array<{ startedAt: string; endedAt: string; reason: string }> {
    return (this.database
      .prepare("SELECT * FROM scanner_monitoring_gaps ORDER BY id DESC LIMIT ?")
      .all(limit) as any[]).map((row) => ({
      startedAt: row.started_at,
      endedAt: row.ended_at,
      reason: row.reason,
    }));
  }

  findByIdentity(identityKey: string): OpportunityRecord | null {
    const row = this.database
      .prepare("SELECT * FROM scanner_opportunities WHERE identity_key = ?")
      .get(identityKey);
    return row ? mapOpportunity(row) : null;
  }

  findById(id: string): OpportunityRecord | null {
    const row = this.database.prepare("SELECT * FROM scanner_opportunities WHERE id = ?").get(id);
    return row ? mapOpportunity(row) : null;
  }

  latestTerminalForMuteKey(muteKey: string, after: string): OpportunityRecord | null {
    const row = this.database
      .prepare(
        `SELECT * FROM scanner_opportunities
         WHERE mute_key = ? AND state IN ('invalidated','expired','missed') AND created_at > ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(muteKey, after);
    return row ? mapOpportunity(row) : null;
  }

  latestTerminalForFamily(
    recipeId: RecipeId,
    symbol: string,
    horizon: Horizon,
    direction: string,
    after: string
  ): OpportunityRecord | null {
    const row = this.database
      .prepare(
        `SELECT * FROM scanner_opportunities
         WHERE recipe_id = ? AND symbol = ? AND horizon = ? AND direction = ?
           AND state IN ('invalidated','expired','missed') AND created_at > ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(recipeId, symbol, horizon, direction, after);
    return row ? mapOpportunity(row) : null;
  }

  listActiveOpportunities(): OpportunityRecord[] {
    return (this.database
      .prepare(
        `SELECT * FROM scanner_opportunities
         WHERE archived = 0 AND state IN ('watching','entry_ready')
         ORDER BY created_at ASC`
      )
      .all() as any[]).map(mapOpportunity);
  }

  listOpportunities(filters: OpportunityFilters = {}): OpportunityRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.horizon) {
      clauses.push("horizon = ?");
      params.push(filters.horizon);
    }
    if (filters.state) {
      clauses.push("state = ?");
      params.push(filters.state);
    }
    if (filters.recipeId) {
      clauses.push("recipe_id = ?");
      params.push(filters.recipeId);
    }
    if (filters.strategy) {
      clauses.push("strategy = ?");
      params.push(filters.strategy);
    }
    if (filters.pinned !== undefined) {
      clauses.push("pinned = ?");
      params.push(filters.pinned ? 1 : 0);
    }
    if (filters.dismissed !== undefined) {
      clauses.push("dismissed = ?");
      params.push(filters.dismissed ? 1 : 0);
    }
    if (!filters.includeHistory) {
      clauses.push("state IN ('watching','entry_ready')");
      clauses.push("archived = 0");
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return (this.database
      .prepare(
        `SELECT * FROM scanner_opportunities ${where}
         ORDER BY pinned DESC, created_at DESC LIMIT ?`
      )
      .all(...params, filters.limit ?? 200) as any[]).map(mapOpportunity);
  }

  checks(opportunityId: string): OpportunityCheck[] {
    return (this.database
      .prepare("SELECT * FROM scanner_opportunity_checks WHERE opportunity_id = ? ORDER BY checked_at ASC")
      .all(opportunityId) as any[]).map((row) => ({
      id: row.id,
      opportunityId: row.opportunity_id,
      checkedAt: row.checked_at,
      health: row.health,
      stateBefore: row.state_before,
      stateAfter: row.state_after,
      evidence: json(row.evidence_json, {}),
      note: row.note ?? null,
    }));
  }

  events(opportunityId: string): ScannerEvent[] {
    return (this.database
      .prepare("SELECT * FROM scanner_events WHERE opportunity_id = ? ORDER BY created_at ASC")
      .all(opportunityId) as any[]).map((row) => ({
      id: row.id,
      opportunityId: row.opportunity_id,
      type: row.type,
      dedupeKey: row.dedupe_key,
      createdAt: row.created_at,
      payload: json(row.payload_json, {}),
    }));
  }

  assessment(opportunityId: string): AiAssessment | null {
    const row = this.database
      .prepare(
        "SELECT * FROM scanner_ai_assessments WHERE opportunity_id = ? ORDER BY id DESC LIMIT 1"
      )
      .get(opportunityId) as any;
    if (!row) return null;
    return {
      opportunityId: row.opportunity_id,
      candidateHash: row.candidate_hash,
      model: row.model,
      promptVersion: row.prompt_version,
      schemaVersion: row.schema_version,
      status: row.status,
      output: json(row.output_json, null),
      inputTokens: row.input_tokens ?? null,
      outputTokens: row.output_tokens ?? null,
      cacheReadTokens: row.cache_read_tokens ?? null,
      cacheWriteTokens: row.cache_write_tokens ?? null,
      estimatedCostUsd: row.estimated_cost_usd ?? null,
      pricingSource: row.pricing_source ?? null,
      error: row.error ?? null,
      createdAt: row.created_at,
    };
  }

  saveAssessment(assessment: AiAssessment): void {
    this.database
      .prepare(
        `INSERT INTO scanner_ai_assessments
          (opportunity_id, candidate_hash, model, prompt_version, schema_version, status, output_json,
           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, estimated_cost_usd,
           pricing_source, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(opportunity_id, candidate_hash) DO UPDATE SET
           status = excluded.status, output_json = excluded.output_json,
           input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
           cache_read_tokens = excluded.cache_read_tokens, cache_write_tokens = excluded.cache_write_tokens,
           estimated_cost_usd = excluded.estimated_cost_usd, pricing_source = excluded.pricing_source,
           error = excluded.error, created_at = excluded.created_at`
      )
      .run(
        assessment.opportunityId,
        assessment.candidateHash,
        assessment.model,
        assessment.promptVersion,
        assessment.schemaVersion,
        assessment.status,
        assessment.output ? JSON.stringify(assessment.output) : null,
        assessment.inputTokens,
        assessment.outputTokens,
        assessment.cacheReadTokens,
        assessment.cacheWriteTokens,
        assessment.estimatedCostUsd,
        assessment.pricingSource,
        assessment.error,
        assessment.createdAt
      );
    this.database
      .prepare("UPDATE scanner_opportunities SET ai_status = ? WHERE id = ?")
      .run(assessment.status, assessment.opportunityId);
  }

  private insertEvent(
    opportunityId: string,
    type: ScannerEvent["type"],
    dedupeKey: string,
    createdAt: string,
    payload: Record<string, unknown>,
    notify: boolean,
    muted: boolean
  ): boolean {
    const result = this.database
      .prepare(
        "INSERT OR IGNORE INTO scanner_events (opportunity_id, type, dedupe_key, created_at, payload_json) VALUES (?, ?, ?, ?, ?)"
      )
      .run(opportunityId, type, dedupeKey, createdAt, JSON.stringify(payload));
    if (result.changes === 0 || !notify || muted) return false;
    const event = this.database
      .prepare("SELECT id FROM scanner_events WHERE dedupe_key = ?")
      .get(dedupeKey) as { id: number } | undefined;
    if (!event) return false;
    this.database
      .prepare(
        "INSERT INTO scanner_notifications (event_id, opportunity_id, type, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(event.id, opportunityId, type, createdAt);
    return true;
  }

  persistDiscovery(
    candidate: OpportunityCandidate,
    configRevision: number,
    predecessorId: string | null,
    createdAiStatus: "pending" | "unavailable" = "pending"
  ): DiscoveryResult {
    const existing = this.findByIdentity(candidate.identityKey);
    if (existing) return { created: false, record: existing, notificationCreated: false };

    const inheritedMuted = Boolean(
      this.database
        .prepare("SELECT muted FROM scanner_opportunities WHERE mute_key = ? AND muted = 1 LIMIT 1")
        .get(candidate.muteKey)
    );
    const createdAt = nowIso();
    const id = candidate.identityKey;
    const record: OpportunityRecord = {
      ...candidate,
      id,
      predecessorId,
      state: "watching",
      pinned: false,
      dismissed: inheritedMuted,
      muted: inheritedMuted,
      archived: false,
      watchlistDecision: "monitor",
      configRevision,
      createdAt,
      updatedAt: createdAt,
      lastCheckedAt: null,
      currentHealth: candidate.dataHealth,
      currentEvidence: null,
      aiStatus: createdAiStatus,
    };

    let notificationCreated = false;
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO scanner_opportunities
            (id, identity_key, mute_key, predecessor_id, symbol, horizon, strategy, direction, recipe_id,
             recipe_version, expiry, deadline, state, data_health, pinned, dismissed, muted, archived,
             watchlist_decision, config_revision, created_at, updated_at, legs_json, risk_json, signal_json,
             conditions_json, thesis, earnings_json, current_evidence_json, ai_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'watching', ?, 0, ?, ?, 0, 'monitor', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
        )
        .run(
          record.id,
          record.identityKey,
          record.muteKey,
          record.predecessorId,
          record.symbol,
          record.horizon,
          record.strategy,
          record.direction,
          record.recipeId,
          record.recipeVersion,
          record.expiry,
          record.deadline,
          record.currentHealth,
          record.dismissed ? 1 : 0,
          record.muted ? 1 : 0,
          record.configRevision,
          record.createdAt,
          record.updatedAt,
          JSON.stringify(record.legs),
          JSON.stringify(record.risk),
          JSON.stringify(record.signal),
          JSON.stringify(record.conditions),
          record.thesis,
          JSON.stringify(record.earnings),
          record.aiStatus
        );
      notificationCreated = this.insertEvent(
        record.id,
        "discovery",
        `discovery:${record.identityKey}`,
        createdAt,
        {
          symbol: record.symbol,
          strategy: record.strategy,
          horizon: record.horizon,
          expiry: record.expiry,
        },
        true,
        record.muted
      );
    })();
    return { created: true, record, notificationCreated };
  }

  appendCheck(input: CheckInput): { record: OpportunityRecord; notificationCreated: number } {
    const current = this.findById(input.opportunityId);
    if (!current) throw new Error("Opportunity not found");
    let notifications = 0;
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE scanner_opportunities
           SET state = ?, data_health = ?, current_evidence_json = ?, last_checked_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.stateAfter,
          input.health,
          JSON.stringify(input.evidence),
          input.checkedAt,
          input.checkedAt,
          input.opportunityId
        );
      this.database
        .prepare(
          `INSERT INTO scanner_opportunity_checks
            (opportunity_id, checked_at, health, state_before, state_after, evidence_json, note)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.opportunityId,
          input.checkedAt,
          input.health,
          input.stateBefore,
          input.stateAfter,
          JSON.stringify(input.evidence),
          input.note
        );
      for (const event of input.events) {
        if (
          this.insertEvent(
            input.opportunityId,
            event.type,
            event.dedupeKey,
            input.checkedAt,
            event.payload,
            event.notify,
            current.muted
          )
        ) {
          notifications += 1;
        }
      }
    })();
    return {
      record: this.findById(input.opportunityId)!,
      notificationCreated: notifications,
    };
  }

  setPinned(id: string, pinned: boolean): OpportunityRecord | null {
    this.database
      .prepare("UPDATE scanner_opportunities SET pinned = ?, updated_at = ? WHERE id = ?")
      .run(pinned ? 1 : 0, nowIso(), id);
    return this.findById(id);
  }

  dismiss(id: string): OpportunityRecord | null {
    this.database
      .prepare(
        "UPDATE scanner_opportunities SET dismissed = 1, muted = 1, updated_at = ? WHERE id = ?"
      )
      .run(nowIso(), id);
    return this.findById(id);
  }

  markWatchlistDecision(id: string, decision: "monitor" | "archive"): OpportunityRecord | null {
    this.database
      .prepare(
        "UPDATE scanner_opportunities SET watchlist_decision = ?, archived = ?, updated_at = ? WHERE id = ?"
      )
      .run(decision, decision === "archive" ? 1 : 0, nowIso(), id);
    return this.findById(id);
  }

  resolveWatchlistSymbol(symbol: string, decision: "monitor" | "archive"): number {
    const result = this.database
      .prepare(
        `UPDATE scanner_opportunities
         SET watchlist_decision = ?, archived = ?, updated_at = ?
         WHERE symbol = ? AND watchlist_decision = 'pending'`
      )
      .run(decision, decision === "archive" ? 1 : 0, nowIso(), symbol);
    return result.changes;
  }

  pendingWatchlistRemovals(): Array<{ symbol: string; opportunityIds: string[] }> {
    const rows = this.database
      .prepare(
        `SELECT symbol, id FROM scanner_opportunities
         WHERE watchlist_decision = 'pending' AND archived = 0
         ORDER BY symbol, created_at`
      )
      .all() as Array<{ symbol: string; id: string }>;
    const map = new Map<string, string[]>();
    for (const row of rows) {
      map.set(row.symbol, [...(map.get(row.symbol) ?? []), row.id]);
    }
    return Array.from(map, ([symbol, opportunityIds]) => ({ symbol, opportunityIds }));
  }

  markRemovedSymbolsPending(symbols: string[]): void {
    if (symbols.length === 0) return;
    const at = nowIso();
    const statement = this.database.prepare(
      `UPDATE scanner_opportunities
       SET watchlist_decision = 'pending', updated_at = ?
       WHERE symbol = ? AND archived = 0 AND state IN ('watching','entry_ready')`
    );
    this.database.transaction(() => {
      for (const symbol of symbols) statement.run(at, symbol);
    })();
  }

  notifications(unreadOnly = false, limit = 100): ScannerNotification[] {
    const where = unreadOnly ? "WHERE read_at IS NULL" : "";
    return (this.database
      .prepare(
        `SELECT * FROM scanner_notifications ${where} ORDER BY created_at DESC LIMIT ?`
      )
      .all(limit) as any[]).map((row) => ({
      id: row.id,
      eventId: row.event_id,
      opportunityId: row.opportunity_id,
      type: row.type,
      createdAt: row.created_at,
      readAt: row.read_at ?? null,
    }));
  }

  unreadCount(): number {
    return (
      this.database
        .prepare("SELECT COUNT(*) AS count FROM scanner_notifications WHERE read_at IS NULL")
        .get() as { count: number }
    ).count;
  }

  markNotificationsRead(ids?: number[]): void {
    const at = nowIso();
    if (!ids || ids.length === 0) {
      this.database.prepare("UPDATE scanner_notifications SET read_at = ? WHERE read_at IS NULL").run(at);
      return;
    }
    const statement = this.database.prepare(
      "UPDATE scanner_notifications SET read_at = ? WHERE id = ? AND read_at IS NULL"
    );
    this.database.transaction(() => {
      for (const id of ids) statement.run(at, id);
    })();
  }

  recordIvObservation(observation: IvObservation): void {
    const date = observation.observedAt.slice(0, 10);
    this.database
      .prepare(
        `INSERT OR REPLACE INTO scanner_iv_observations
          (symbol, tenor_days, moneyness, observed_at, observation_date, iv, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        observation.symbol,
        observation.tenorDays,
        observation.moneyness,
        observation.observedAt,
        date,
        observation.iv,
        observation.source
      );
  }

  ivSummary(symbol: string, lookbackDays: number, minTenorDays = 25, maxTenorDays = 45): IvSummary {
    const cutoff = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
    const rows = this.database
      .prepare(
        `SELECT observed_at, observation_date, iv FROM scanner_iv_observations
         WHERE symbol = ? AND observed_at >= ? AND moneyness = 'ATM'
           AND tenor_days BETWEEN ? AND ?
         ORDER BY observed_at ASC`
      )
      .all(symbol, cutoff, minTenorDays, maxTenorDays) as Array<{ observed_at: string; observation_date: string; iv: number }>;
    if (rows.length === 0) {
      return { observations: 0, days: 0, current: null, percentile: null, latestAt: null };
    }
    const latest = rows[rows.length - 1];
    const days = new Set(rows.map((row) => row.observation_date)).size;
    const percentile =
      (rows.filter((row) => row.iv <= latest.iv).length / rows.length) * 100;
    return {
      observations: rows.length,
      days,
      current: latest.iv,
      percentile,
      latestAt: latest.observed_at,
    };
  }

  aiUsage(): { inputTokens: number; outputTokens: number; estimatedCostUsd: number | null; unknownCostAssessments: number } {
    const row = this.database
      .prepare(
        `SELECT
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          SUM(estimated_cost_usd) AS estimated_cost,
          COALESCE(SUM(CASE WHEN estimated_cost_usd IS NULL THEN 1 ELSE 0 END), 0) AS unknown
         FROM scanner_ai_assessments`
      )
      .get() as {
      input_tokens: number;
      output_tokens: number;
      estimated_cost: number | null;
      unknown: number;
    };
    return {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      estimatedCostUsd: row.estimated_cost,
      unknownCostAssessments: row.unknown,
    };
  }

  leaseOwner(): string | null {
    const row = this.database
      .prepare("SELECT owner, expires_at FROM scanner_lease WHERE id = 1")
      .get() as { owner: string; expires_at: number } | undefined;
    return row && row.expires_at > Date.now() ? row.owner : null;
  }

  newOwner(): string {
    return `${process.pid}-${randomUUID()}`;
  }
}

export function createScannerStore(database: Database.Database): ScannerStore {
  return new ScannerStore(database);
}
