import { Router } from "express";
import { normalizeScannerConfig, scannerReadiness } from "../scanner/config.js";
import { sessionState } from "../scanner/calendar.js";
import { nextScheduledAt, ScannerEngine } from "../scanner/engine.js";
import { createHttpScannerMarketData } from "../scanner/market.js";
import { RECIPES } from "../scanner/recipes.js";
import { ScannerScheduler } from "../scanner/scheduler.js";
import { createScannerStore } from "../scanner/store.js";
import { db } from "../db.js";
import type { ScannerStatus } from "../scanner/types.js";

export const scannerStoreSingleton = createScannerStore(db);
const scannerStore = scannerStoreSingleton;
export const scannerEngine = new ScannerEngine({
  store: scannerStore,
  market: createHttpScannerMarketData(),
});
export const scannerScheduler = new ScannerScheduler(scannerEngine, scannerStore);

export function scannerStatus(now = new Date()): ScannerStatus {
  const config = scannerStore.getConfig();
  const lastRun = scannerStore.lastRun();
  const lastCompleted = scannerStore.lastCompletedRun();
  return {
    config,
    definitions: Object.values(RECIPES),
    readiness: scannerReadiness(config),
    session: sessionState(now),
    lastRun,
    nextScheduledAt: nextScheduledAt(config, lastCompleted, now),
    monitoringGaps: scannerStore
      .monitoringGaps()
      .map((gap) => `${gap.startedAt} → ${gap.endedAt}: ${gap.reason}`),
    pendingWatchlistRemovals: scannerStore.pendingWatchlistRemovals(),
    unreadNotifications: scannerStore.unreadCount(),
    aiUsage: scannerStore.aiUsage(),
  };
}

export const scannerRouter = Router();

scannerRouter.get("/status", (_req, res) => {
  res.json(scannerStatus());
});

scannerRouter.put("/config", (req, res) => {
  const previous = scannerStore.getConfig();
  const body = req.body ?? {};
  try {
    const normalized = normalizeScannerConfig(body.config ?? body, previous);
    const saved = scannerStore.saveConfig({
      ...normalized,
      revision: previous.revision + 1,
      enabled: false,
      watchlist: previous.watchlist,
      watchlistRevision: previous.watchlistRevision,
    });
    res.json({ config: saved, readiness: scannerReadiness(saved) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

scannerRouter.post("/activate", (_req, res) => {
  const config = scannerStore.getConfig();
  const readiness = scannerReadiness(config);
  if (!readiness.ready) {
    return res.status(400).json({
      error: "Scanner configuration is not ready for activation",
      readiness,
    });
  }
  const saved = scannerStore.saveConfig(
    { ...config, revision: config.revision + 1, enabled: true },
    true
  );
  res.json({ ok: true, config: saved, status: scannerStatus() });
});

scannerRouter.post("/pause", (_req, res) => {
  const config = scannerStore.getConfig();
  const saved = scannerStore.saveConfig(
    { ...config, revision: config.revision + 1, enabled: false },
    false
  );
  res.json({ ok: true, config: saved });
});

scannerRouter.post("/watchlist", (req, res) => {
  const symbols = Array.isArray(req.body?.symbols)
    ? req.body.symbols.filter((symbol: unknown): symbol is string => typeof symbol === "string")
    : null;
  if (!symbols) return res.status(400).json({ error: "symbols array required" });
  const baseRevision =
    typeof req.body?.baseRevision === "number" ? req.body.baseRevision : null;
  const force = req.body?.force === true;
  const result = scannerStore.updateWatchlist(symbols, baseRevision, force);
  if (!result.ok) {
    return res.status(409).json({
      error: "Watchlist changed in another tab; review the current list before syncing again",
      current: result.current,
      revision: result.revision,
    });
  }
  scannerStore.markRemovedSymbolsPending(result.removed);
  res.json({
    ok: true,
    added: result.added,
    removed: result.removed,
    config: result.config,
    pendingWatchlistRemovals: scannerStore.pendingWatchlistRemovals(),
    status: scannerStatus(),
  });
});

scannerRouter.post("/watchlist/decision", (req, res) => {
  const symbol =
    typeof req.body?.symbol === "string" ? req.body.symbol.trim().toUpperCase() : "";
  const decision = req.body?.decision;
  if (!symbol || (decision !== "monitor" && decision !== "archive")) {
    return res.status(400).json({ error: "symbol and decision (monitor|archive) required" });
  }
  const changed = scannerStore.resolveWatchlistSymbol(symbol, decision);
  res.json({ ok: true, changed, pendingWatchlistRemovals: scannerStore.pendingWatchlistRemovals() });
});

scannerRouter.get("/opportunities", (req, res) => {
  const horizon = req.query.horizon === "intraday" || req.query.horizon === "swing"
    ? req.query.horizon
    : undefined;
  const state =
    req.query.state === "watching" ||
    req.query.state === "entry_ready" ||
    req.query.state === "invalidated" ||
    req.query.state === "expired"
      ? req.query.state
      : undefined;
  const opportunities = scannerStore.listOpportunities({
    horizon,
    state,
    recipeId: typeof req.query.recipeId === "string" ? (req.query.recipeId as any) : undefined,
    strategy: typeof req.query.strategy === "string" ? req.query.strategy : undefined,
    pinned: req.query.pinned === "true" ? true : req.query.pinned === "false" ? false : undefined,
    dismissed:
      req.query.dismissed === "true" ? true : req.query.dismissed === "false" ? false : undefined,
    includeHistory: req.query.history === "true",
    limit: Math.min(500, Math.max(1, Number(req.query.limit) || 200)),
  });
  res.json(opportunities);
});

scannerRouter.get("/opportunities/:id", (req, res) => {
  const opportunity = scannerStore.findById(req.params.id);
  if (!opportunity) return res.status(404).json({ error: "Opportunity not found" });
  res.json({
    opportunity,
    checks: scannerStore.checks(opportunity.id),
    events: scannerStore.events(opportunity.id),
    assessment: scannerStore.assessment(opportunity.id),
  });
});

scannerRouter.post("/opportunities/:id/pin", (req, res) => {
  const pinned = req.body?.pinned === true;
  const opportunity = scannerStore.setPinned(req.params.id, pinned);
  if (!opportunity) return res.status(404).json({ error: "Opportunity not found" });
  res.json(opportunity);
});

scannerRouter.post("/opportunities/:id/dismiss", (req, res) => {
  const opportunity = scannerStore.dismiss(req.params.id);
  if (!opportunity) return res.status(404).json({ error: "Opportunity not found" });
  res.json(opportunity);
});

scannerRouter.get("/notifications", (req, res) => {
  res.json(scannerStore.notifications(req.query.unread === "true", 200));
});

scannerRouter.post("/notifications/read", (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.filter((id: unknown): id is number => typeof id === "number")
    : undefined;
  scannerStore.markNotificationsRead(ids);
  res.json({ ok: true, unread: scannerStore.unreadCount() });
});
