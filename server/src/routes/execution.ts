import { Router, type Response } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { createPaperBroker } from "../execution/adapters/paper/broker.js";
import { modelFill, type FillModelQuote } from "../execution/adapters/paper/fillModel.js";
import { ExecutionEngine } from "../execution/engine.js";
import { ExecutionScheduler } from "../execution/scheduler.js";
import { normalizeExecutionConfig } from "../execution/config.js";
import { quotesFromChain } from "../execution/pricing.js";
import { createExecutionStore } from "../execution/store.js";
import type { ExecutionError, ExecutionTradeStatus } from "../execution/types.js";
import type { BrokerOrderRequest } from "../execution/ports/broker.js";
import { createHttpScannerMarketData } from "../scanner/market.js";
import { scannerStoreSingleton } from "./scanner.js";

export const executionStore = createExecutionStore(db);
const market = createHttpScannerMarketData();

type QuoteCacheEntry = { expiresAt: number; quotes: Map<string, FillModelQuote> };
const quoteCache = new Map<string, QuoteCacheEntry>();

async function fillProvider(request: BrokerOrderRequest, at: Date) {
  const expiry = request.instrument.expiry;
  if (!expiry) {
    return {
      ok: false as const,
      error: { kind: "invalid_config" as const, message: "option order requires an expiry" },
    };
  }

  const key = `${request.instrument.underlying}:${expiry}`;
  const now = Date.now();
  let cached = quoteCache.get(key);
  if (!cached || cached.expiresAt <= now) {
    try {
      const chain = await market.chain(request.instrument.underlying, expiry);
      cached = { expiresAt: now + 2_000, quotes: quotesFromChain(chain) };
      quoteCache.set(key, cached);
    } catch (error) {
      return {
        ok: false as const,
        error: {
          kind: "market_unavailable" as const,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  const config = executionStore.getConfig();
  return modelFill({
    request,
    quotes: cached.quotes,
    now: at,
    config: {
      spreadFactor: config.slippage.spreadFactor,
      impactBps: config.slippage.impactBps,
      jitterBps: config.slippage.jitterBps,
      maxSlippagePct: config.slippage.maxSlippagePct,
      maxQuoteAgeMs: config.quotes.maxQuoteAgeMs,
      fees: config.fees,
    },
    seed: request.clientOrderId,
  });
}

const initialConfig = executionStore.getConfig();
// The paper broker is in-memory; rebuild its ledger from persisted fills so
// cash, positions and equity are continuous across API restarts.
const seedFills = executionStore.listAllFills().map((fill) => ({
  contractSymbol: fill.contractSymbol,
  side: fill.side,
  quantity: fill.quantity,
  price: fill.price,
  multiplier: fill.multiplier,
  feesUsd: fill.feesUsd,
}));
const broker = createPaperBroker({
  fill: fillProvider,
  startingCashUsd: initialConfig.startingCashUsd,
  seedFills,
});
// Drop equity points recorded while a previous process had lost its ledger.
executionStore.deleteResetEquitySnapshots(initialConfig.startingCashUsd);

export const executionEngine = new ExecutionEngine({
  store: executionStore,
  broker,
  market,
  setups: {
    find: (opportunityId) => scannerStoreSingleton.findById(opportunityId),
    listEntryReady: () =>
      scannerStoreSingleton.listOpportunities({ state: "entry_ready", limit: 50 }),
  },
});

export const executionScheduler = new ExecutionScheduler(executionEngine, executionStore);

export const executionRouter = Router();

const AutomationPatch = z
  .object({ entries: z.boolean().optional(), exits: z.boolean().optional() })
  .strict();
const ExitsPatch = z
  .object({
    profitTargetFraction: z.number().min(0.05).max(2).optional(),
    stopLossFraction: z.number().min(0.1).max(5).optional(),
    timeStopMinutes: z.number().int().min(1).nullable().optional(),
  })
  .strict();
const SlippagePatch = z
  .object({
    spreadFactor: z.number().min(0).max(2).optional(),
    impactBps: z.number().min(0).max(500).optional(),
    jitterBps: z.number().min(0).max(100).optional(),
    maxSlippagePct: z.number().min(0.01).max(100).optional(),
  })
  .strict();
const QuotesPatch = z
  .object({
    maxQuoteAgeMs: z.number().int().min(1_000).optional(),
    limitBufferPct: z.number().min(0).max(10).optional(),
  })
  .strict();
const FeesPatch = z
  .object({
    perOrderUsd: z.number().min(0).max(100).optional(),
    perContractUsd: z.number().min(0).max(100).optional(),
  })
  .strict();
const LimitsPatch = z
  .object({
    maxOpenTrades: z.number().int().min(1).max(100).optional(),
    maxPerSymbol: z.number().int().min(1).max(100).optional(),
  })
  .strict();

const ConfigPatch = z
  .object({
    enabled: z.boolean().optional(),
    automation: AutomationPatch.optional(),
    exits: ExitsPatch.optional(),
    slippage: SlippagePatch.optional(),
    quotes: QuotesPatch.optional(),
    fees: FeesPatch.optional(),
    limits: LimitsPatch.optional(),
  })
  .strict();

const TRADE_STATUSES: ReadonlySet<string> = new Set<ExecutionTradeStatus>([
  "pending_entry",
  "open",
  "pending_exit",
  "closed",
  "rejected",
  "cancelled",
]);

function errorStatus(error: ExecutionError): number {
  switch (error.kind) {
    case "not_found":
      return 404;
    case "setup_not_ready":
    case "already_traded":
    case "busy":
    case "invalid_state":
      return 409;
    case "market_data":
      return 503;
    case "broker":
      return 422;
    case "internal":
      return 500;
  }
}

function sendError(res: Response, error: ExecutionError) {
  const payload =
    error.kind === "broker"
      ? { kind: error.kind, error: error.error.message, brokerError: error.error }
      : { kind: error.kind, error: error.message };
  res.status(errorStatus(error)).json(payload);
}

executionRouter.get("/status", async (_req, res) => {
  try {
    res.json(await executionEngine.status());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

executionRouter.put("/config", (req, res) => {
  const parsed = ConfigPatch.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
        .join("; "),
    });
  }

  const current = executionStore.getConfig();
  const patch = parsed.data;
  const merged = normalizeExecutionConfig(
    {
      ...current,
      ...patch,
      automation: { ...current.automation, ...patch.automation },
      exits: { ...current.exits, ...patch.exits },
      slippage: { ...current.slippage, ...patch.slippage },
      quotes: { ...current.quotes, ...patch.quotes },
      fees: { ...current.fees, ...patch.fees },
      limits: { ...current.limits, ...patch.limits },
    },
    current
  );
  res.json({ config: executionStore.saveConfig(merged) });
});

executionRouter.get("/equity", (req, res) => {
  const limit = Math.min(1_000, Math.max(1, Number(req.query.limit) || 200));
  res.json({
    latest: executionStore.latestEquity(),
    history: executionStore.equityHistory(limit),
  });
});

executionRouter.get("/trades", (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (status && !TRADE_STATUSES.has(status)) {
    return res.status(400).json({ error: "invalid trade status" });
  }
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  res.json(executionEngine.listTrades({ status: status as ExecutionTradeStatus | undefined, limit }));
});

executionRouter.get("/trades/:id", (req, res) => {
  const detail = executionEngine.getTrade(req.params.id);
  if (!detail) return res.status(404).json({ error: "Trade not found" });
  res.json(detail);
});

executionRouter.post("/enter", async (req, res) => {
  const opportunityId =
    typeof req.body?.opportunityId === "string" ? req.body.opportunityId.trim() : "";
  if (!opportunityId) {
    return res.status(400).json({ error: "opportunityId is required" });
  }

  const result = await executionEngine.enter(opportunityId);
  if (!result.ok) return sendError(res, result.error);

  const trade = result.value;
  res.status(trade.status === "open" ? 201 : 202).json({ trade });
});

executionRouter.post("/trades/:id/close", async (req, res) => {
  const result = await executionEngine.close(req.params.id);
  if (!result.ok) return sendError(res, result.error);

  const trade = result.value;
  res.status(trade.status === "closed" ? 200 : 202).json({ trade });
});

