import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { db as defaultDb } from "../db.js";
import {
  normalizeExecutionConfig,
  type ExecutionConfig,
} from "./config.js";
import type { FillSummary } from "./domain/fill.js";
import type { OrderState } from "./domain/order.js";
import { submittedOrder } from "./domain/order.js";
import type { TradePnl } from "./domain/pnl.js";
import type { BrokerOrderRequest } from "./ports/broker.js";
import type {
  EquitySnapshot,
  ExecutionEvent,
  ExecutionFill,
  ExecutionIntent,
  ExecutionMark,
  ExecutionOrder,
  ExecutionTrade,
  ExecutionTradeStatus,
} from "./types.js";
import type { OpportunityRecord } from "../scanner/types.js";

export type ExecutionMigration = { version: number; sql: string };

export const EXECUTION_MIGRATIONS: ExecutionMigration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE execution_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE execution_trades (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  symbol TEXT NOT NULL,
  horizon TEXT NOT NULL,
  strategy TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_entry','open','pending_exit','closed','rejected','cancelled')),
  setup_json TEXT NOT NULL,
  entry_order_id TEXT,
  exit_order_id TEXT,
  entry_summary_json TEXT,
  exit_summary_json TEXT,
  pnl_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  opened_at TEXT,
  closed_at TEXT
);
CREATE INDEX execution_trades_opportunity_idx ON execution_trades(opportunity_id, created_at DESC);
CREATE INDEX execution_trades_status_idx ON execution_trades(status, created_at DESC);

CREATE TABLE execution_orders (
  client_order_id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL REFERENCES execution_trades(id) ON DELETE CASCADE,
  intent TEXT NOT NULL CHECK (intent IN ('entry','exit')),
  broker_order_id TEXT,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX execution_orders_trade_idx ON execution_orders(trade_id);
CREATE INDEX execution_orders_broker_idx ON execution_orders(broker_order_id);

CREATE TABLE execution_fills (
  fill_id TEXT PRIMARY KEY,
  client_order_id TEXT NOT NULL REFERENCES execution_orders(client_order_id) ON DELETE CASCADE,
  trade_id TEXT NOT NULL,
  contract_symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  reference_mid REAL NOT NULL,
  multiplier REAL NOT NULL,
  slippage_usd REAL NOT NULL,
  fees_usd REAL NOT NULL,
  filled_at TEXT NOT NULL
);
CREATE INDEX execution_fills_trade_idx ON execution_fills(trade_id, filled_at);
CREATE INDEX execution_fills_order_idx ON execution_fills(client_order_id);

CREATE TABLE execution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id TEXT,
  type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX execution_events_trade_idx ON execution_events(trade_id, created_at);

CREATE TABLE execution_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`,
  },
  {
    version: 2,
    sql: `
CREATE TABLE execution_marks (
  trade_id TEXT NOT NULL REFERENCES execution_trades(id) ON DELETE CASCADE,
  marked_at TEXT NOT NULL,
  liquidation_value_usd REAL NOT NULL,
  underlying_price REAL,
  PRIMARY KEY (trade_id, marked_at)
);
CREATE INDEX execution_marks_trade_idx ON execution_marks(trade_id, marked_at DESC);

CREATE TABLE execution_equity (
  as_of TEXT PRIMARY KEY,
  cash_usd REAL NOT NULL,
  positions_usd REAL NOT NULL,
  equity_usd REAL NOT NULL
);
`,
  },
];

function applyMigration(database: Database.Database, migration: ExecutionMigration) {
  database.transaction(() => {
    database.exec(migration.sql);
    database
      .prepare("INSERT INTO execution_schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(migration.version, nowIso());
  })();
}

function migrate(database: Database.Database) {
  database.exec(
    "CREATE TABLE IF NOT EXISTS execution_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
  );
  for (const migration of EXECUTION_MIGRATIONS) {
    const applied = database
      .prepare("SELECT version FROM execution_schema_migrations WHERE version = ?")
      .get(migration.version);
    if (applied) continue;
    applyMigration(database, migration);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function json<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function jsonOrNull<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function mapTrade(row: any): ExecutionTrade {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    identityKey: row.identity_key,
    symbol: row.symbol,
    horizon: row.horizon,
    strategy: row.strategy,
    status: row.status as ExecutionTradeStatus,
    setup: json<OpportunityRecord>(row.setup_json, {} as OpportunityRecord),
    entryOrderId: row.entry_order_id ?? null,
    exitOrderId: row.exit_order_id ?? null,
    entrySummary: jsonOrNull<FillSummary>(row.entry_summary_json),
    exitSummary: jsonOrNull<FillSummary>(row.exit_summary_json),
    pnl: jsonOrNull<TradePnl>(row.pnl_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    openedAt: row.opened_at ?? null,
    closedAt: row.closed_at ?? null,
  };
}

function mapOrder(row: any): ExecutionOrder {
  return {
    clientOrderId: row.client_order_id,
    tradeId: row.trade_id,
    intent: row.intent as ExecutionIntent,
    brokerOrderId: row.broker_order_id ?? null,
    status: row.status as OrderState["status"],
    request: json<BrokerOrderRequest>(row.request_json, {} as BrokerOrderRequest),
    state: json<OrderState>(row.state_json, {} as OrderState),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFill(row: any): ExecutionFill {
  return {
    fillId: row.fill_id,
    clientOrderId: row.client_order_id,
    tradeId: row.trade_id,
    contractSymbol: row.contract_symbol,
    side: row.side,
    quantity: row.quantity,
    price: row.price,
    referenceMid: row.reference_mid,
    multiplier: row.multiplier,
    slippageUsd: row.slippage_usd,
    feesUsd: row.fees_usd,
    filledAt: row.filled_at,
  };
}

function mapEvent(row: any): ExecutionEvent {
  return {
    id: row.id,
    tradeId: row.trade_id ?? null,
    type: row.type,
    dedupeKey: row.dedupe_key,
    payload: json<Record<string, unknown>>(row.payload_json, {}),
    createdAt: row.created_at,
  };
}

export type ExecutionTradePatch = Partial<{
  status: ExecutionTradeStatus;
  entryOrderId: string | null;
  exitOrderId: string | null;
  entrySummary: FillSummary | null;
  exitSummary: FillSummary | null;
  pnl: TradePnl | null;
  openedAt: string | null;
  closedAt: string | null;
}>;

export type ExecutionOrderPatch = Partial<{
  brokerOrderId: string | null;
  status: OrderState["status"];
  state: OrderState;
}>;

export class ExecutionStore {
  constructor(private readonly database: Database.Database = defaultDb) {
    migrate(database);
    const existing = database.prepare("SELECT id FROM execution_config WHERE id = 1").get();
    if (!existing) {
      database
        .prepare(
          "INSERT INTO execution_config (id, revision, config_json, updated_at) VALUES (1, 0, ?, ?)"
        )
        .run(JSON.stringify(normalizeExecutionConfig(null)), nowIso());
    }
  }

  getConfig(): ExecutionConfig {
    const row = this.database
      .prepare("SELECT config_json FROM execution_config WHERE id = 1")
      .get() as { config_json: string } | undefined;
    return normalizeExecutionConfig(json<unknown>(row?.config_json, null));
  }

  saveConfig(config: ExecutionConfig): ExecutionConfig {
    const normalized = normalizeExecutionConfig(config, this.getConfig());
    this.database
      .prepare(
        "UPDATE execution_config SET revision = revision + 1, config_json = ?, updated_at = ? WHERE id = 1"
      )
      .run(JSON.stringify(normalized), nowIso());
    return normalized;
  }

  newOwner(): string {
    return randomUUID();
  }

  acquireLease(owner: string, ttlMs: number): boolean {
    const now = Date.now();
    const result = this.database
      .prepare(
        `INSERT INTO execution_lease (id, owner, expires_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
         WHERE execution_lease.expires_at <= ? OR execution_lease.owner = excluded.owner`
      )
      .run(owner, now + ttlMs, now);
    return result.changes > 0;
  }

  releaseLease(owner: string): void {
    this.database.prepare("DELETE FROM execution_lease WHERE id = 1 AND owner = ?").run(owner);
  }

  clearLease(): void {
    this.database.prepare("DELETE FROM execution_lease").run();
  }

  runInTransaction<T>(fn: () => T): T {
    return this.database.transaction(fn)();
  }

  createTrade(input: {
    id: string;
    opportunityId: string;
    identityKey: string;
    symbol: string;
    horizon: string;
    strategy: string;
    setup: OpportunityRecord;
  }): ExecutionTrade {
    const at = nowIso();
    this.database
      .prepare(
        `INSERT INTO execution_trades
          (id, opportunity_id, identity_key, symbol, horizon, strategy, status, setup_json,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending_entry', ?, ?, ?)`
      )
      .run(
        input.id,
        input.opportunityId,
        input.identityKey,
        input.symbol,
        input.horizon,
        input.strategy,
        JSON.stringify(input.setup),
        at,
        at
      );
    return this.findTrade(input.id)!;
  }

  updateTrade(id: string, patch: ExecutionTradePatch): ExecutionTrade {
    const fields: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      fields.push(`${column} = ?`);
      values.push(value);
    };

    if (patch.status !== undefined) add("status", patch.status);
    if (patch.entryOrderId !== undefined) add("entry_order_id", patch.entryOrderId);
    if (patch.exitOrderId !== undefined) add("exit_order_id", patch.exitOrderId);
    if (patch.entrySummary !== undefined) {
      add("entry_summary_json", patch.entrySummary === null ? null : JSON.stringify(patch.entrySummary));
    }
    if (patch.exitSummary !== undefined) {
      add("exit_summary_json", patch.exitSummary === null ? null : JSON.stringify(patch.exitSummary));
    }
    if (patch.pnl !== undefined) {
      add("pnl_json", patch.pnl === null ? null : JSON.stringify(patch.pnl));
    }
    if (patch.openedAt !== undefined) add("opened_at", patch.openedAt);
    if (patch.closedAt !== undefined) add("closed_at", patch.closedAt);

    fields.push("updated_at = ?");
    values.push(nowIso());
    values.push(id);

    this.database.prepare(`UPDATE execution_trades SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return this.findTrade(id)!;
  }

  findTrade(id: string): ExecutionTrade | null {
    const row = this.database.prepare("SELECT * FROM execution_trades WHERE id = ?").get(id);
    return row ? mapTrade(row) : null;
  }

  findByOpportunity(opportunityId: string): ExecutionTrade | null {
    const row = this.database
      .prepare(
        "SELECT * FROM execution_trades WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1"
      )
      .get(opportunityId);
    return row ? mapTrade(row) : null;
  }

  listTrades(filters: { status?: ExecutionTradeStatus; limit?: number } = {}): ExecutionTrade[] {
    const rows = filters.status
      ? this.database
          .prepare(
            "SELECT * FROM execution_trades WHERE status = ? ORDER BY created_at DESC LIMIT ?"
          )
          .all(filters.status, filters.limit ?? 100)
      : this.database
          .prepare("SELECT * FROM execution_trades ORDER BY created_at DESC LIMIT ?")
          .all(filters.limit ?? 100);
    return (rows as any[]).map(mapTrade);
  }

  listPendingTrades(): ExecutionTrade[] {
    return (this.database
      .prepare(
        "SELECT * FROM execution_trades WHERE status IN ('pending_entry','pending_exit') ORDER BY created_at"
      )
      .all() as any[]).map(mapTrade);
  }

  listOpenTrades(): ExecutionTrade[] {
    return (this.database
      .prepare(
        "SELECT * FROM execution_trades WHERE status IN ('pending_entry','open','pending_exit') ORDER BY created_at"
      )
      .all() as any[]).map(mapTrade);
  }

  createOrder(input: {
    clientOrderId: string;
    tradeId: string;
    intent: ExecutionIntent;
    request: BrokerOrderRequest;
  }): ExecutionOrder {
    const at = nowIso();
    const state = submittedOrder(input.request, at);
    this.database
      .prepare(
        `INSERT INTO execution_orders
          (client_order_id, trade_id, intent, broker_order_id, status, request_json, state_json,
           created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'submitted', ?, ?, ?, ?)`
      )
      .run(
        input.clientOrderId,
        input.tradeId,
        input.intent,
        JSON.stringify(input.request),
        JSON.stringify(state),
        at,
        at
      );
    return this.findOrder(input.clientOrderId)!;
  }

  updateOrder(clientOrderId: string, patch: ExecutionOrderPatch): ExecutionOrder {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.brokerOrderId !== undefined) {
      fields.push("broker_order_id = ?");
      values.push(patch.brokerOrderId);
    }
    if (patch.status !== undefined) {
      fields.push("status = ?");
      values.push(patch.status);
    }
    if (patch.state !== undefined) {
      fields.push("state_json = ?");
      values.push(JSON.stringify(patch.state));
    }
    fields.push("updated_at = ?");
    values.push(nowIso());
    values.push(clientOrderId);
    this.database
      .prepare(`UPDATE execution_orders SET ${fields.join(", ")} WHERE client_order_id = ?`)
      .run(...values);
    return this.findOrder(clientOrderId)!;
  }

  findOrder(clientOrderId: string): ExecutionOrder | null {
    const row = this.database
      .prepare("SELECT * FROM execution_orders WHERE client_order_id = ?")
      .get(clientOrderId);
    return row ? mapOrder(row) : null;
  }

  listOrders(tradeId: string): ExecutionOrder[] {
    return (this.database
      .prepare("SELECT * FROM execution_orders WHERE trade_id = ? ORDER BY created_at")
      .all(tradeId) as any[]).map(mapOrder);
  }

  /** Idempotent: fill ids are the identity and duplicate frames are ignored. */
  insertFills(fills: readonly ExecutionFill[]): number {
    const statement = this.database.prepare(
      `INSERT OR IGNORE INTO execution_fills
        (fill_id, client_order_id, trade_id, contract_symbol, side, quantity, price, reference_mid,
         multiplier, slippage_usd, fees_usd, filled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    let inserted = 0;
    this.database.transaction(() => {
      for (const fill of fills) {
        const result = statement.run(
          fill.fillId,
          fill.clientOrderId,
          fill.tradeId,
          fill.contractSymbol,
          fill.side,
          fill.quantity,
          fill.price,
          fill.referenceMid,
          fill.multiplier,
          fill.slippageUsd,
          fill.feesUsd,
          fill.filledAt
        );
        inserted += result.changes;
      }
    })();
    return inserted;
  }

  listFills(tradeId: string): ExecutionFill[] {
    return (this.database
      .prepare("SELECT * FROM execution_fills WHERE trade_id = ? ORDER BY filled_at, fill_id")
      .all(tradeId) as any[]).map(mapFill);
  }

  listOrderFills(clientOrderId: string): ExecutionFill[] {
    return (this.database
      .prepare("SELECT * FROM execution_fills WHERE client_order_id = ? ORDER BY filled_at, fill_id")
      .all(clientOrderId) as any[]).map(mapFill);
  }

  appendEvent(input: {
    tradeId: string | null;
    type: string;
    dedupeKey: string;
    payload: Record<string, unknown>;
    createdAt?: string;
  }): boolean {
    const result = this.database
      .prepare(
        "INSERT OR IGNORE INTO execution_events (trade_id, type, dedupe_key, payload_json, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        input.tradeId,
        input.type,
        input.dedupeKey,
        JSON.stringify(input.payload),
        input.createdAt ?? nowIso()
      );
    return result.changes > 0;
  }

  listEvents(tradeId: string): ExecutionEvent[] {
    return (this.database
      .prepare("SELECT * FROM execution_events WHERE trade_id = ? ORDER BY created_at, id")
      .all(tradeId) as any[]).map(mapEvent);
  }

  recordMark(mark: ExecutionMark): void {
    this.database
      .prepare(
        `INSERT OR REPLACE INTO execution_marks
          (trade_id, marked_at, liquidation_value_usd, underlying_price)
         VALUES (?, ?, ?, ?)`
      )
      .run(mark.tradeId, mark.markedAt, mark.liquidationValueUsd, mark.underlyingPrice);
  }

  listMarks(tradeId: string, limit = 100): ExecutionMark[] {
    return (this.database
      .prepare(
        "SELECT * FROM execution_marks WHERE trade_id = ? ORDER BY marked_at DESC LIMIT ?"
      )
      .all(tradeId, limit) as any[]).map((row) => ({
      tradeId: row.trade_id,
      markedAt: row.marked_at,
      liquidationValueUsd: row.liquidation_value_usd,
      underlyingPrice: row.underlying_price ?? null,
    }));
  }

  recordEquity(snapshot: EquitySnapshot): void {
    this.database
      .prepare(
        `INSERT OR REPLACE INTO execution_equity (as_of, cash_usd, positions_usd, equity_usd)
         VALUES (?, ?, ?, ?)`
      )
      .run(snapshot.asOf, snapshot.cashUsd, snapshot.positionsUsd, snapshot.equityUsd);
  }

  latestEquity(): EquitySnapshot | null {
    const row = this.database
      .prepare("SELECT * FROM execution_equity ORDER BY as_of DESC LIMIT 1")
      .get() as any;
    if (!row) return null;
    return {
      asOf: row.as_of,
      cashUsd: row.cash_usd,
      positionsUsd: row.positions_usd,
      equityUsd: row.equity_usd,
    };
  }

  equityHistory(limit = 200): EquitySnapshot[] {
    return (this.database
      .prepare("SELECT * FROM execution_equity ORDER BY as_of DESC LIMIT ?")
      .all(limit) as any[]).map((row) => ({
      asOf: row.as_of,
      cashUsd: row.cash_usd,
      positionsUsd: row.positions_usd,
      equityUsd: row.equity_usd,
    }));
  }

  counts(): Record<ExecutionTradeStatus, number> {
    const counts: Record<ExecutionTradeStatus, number> = {
      pending_entry: 0,
      open: 0,
      pending_exit: 0,
      closed: 0,
      rejected: 0,
      cancelled: 0,
    };
    const rows = this.database
      .prepare("SELECT status, COUNT(*) AS count FROM execution_trades GROUP BY status")
      .all() as Array<{ status: ExecutionTradeStatus; count: number }>;
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }
}

export function createExecutionStore(database: Database.Database = defaultDb): ExecutionStore {
  return new ExecutionStore(database);
}
