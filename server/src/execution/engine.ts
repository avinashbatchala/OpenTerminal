import { randomUUID } from "node:crypto";
import { mapWithConcurrency } from "../concurrency.js";
import { sessionState } from "../scanner/calendar.js";
import type { NormalizedChain, ScannerMarketData } from "../scanner/market.js";
import type { OpportunityRecord, ScannerLeg } from "../scanner/types.js";
import type {
  BrokerError,
  BrokerOrderRequest,
  BrokerOrderUpdate,
  BrokerPort,
  Result,
} from "./ports/broker.js";
import { asClientOrderId, err, ok } from "./ports/broker.js";
import type { ExecutionConfig } from "./config.js";
import { roundMoney } from "./domain/fill.js";
import { legSlippage, summarizeLegFills, type LegFill } from "./domain/fill.js";
import { applyBrokerUpdate, type OrderState } from "./domain/order.js";
import { computeTradePnl } from "./domain/pnl.js";
import { evaluateExit, type ExitReason } from "./exits.js";
import { packageLimitPrice, packageTouchPrice, quotesFromChain } from "./pricing.js";
import type { ExecutionStore } from "./store.js";
import type {
  AutomationOutcome,
  EquitySnapshot,
  ExecutionError,
  ExecutionLiveStatus,
  ExecutionMark,
  ExecutionMarkEvent,
  ExecutionResult,
  ExecutionStatus,
  ExecutionTrade,
  ExecutionTradeStatus,
  OptionQuote,
  OptionQuoteSource,
  SetupSource,
} from "./types.js";

export type ExecutionEngineOptions = {
  store: ExecutionStore;
  broker: BrokerPort;
  market: ScannerMarketData;
  setups: SetupSource;
  /**
   * Optional live option quotes. When present, marks update on each quote and
   * the engine falls back to polling the chain when quotes go stale.
   */
  optionQuotes?: OptionQuoteSource;
  now?: () => Date;
  logger?: (message: string) => void;
};

const LEASE_MS = 30_000;
const LIVE_MARK_INTERVAL_MS = 5_000;
const LIVE_QUOTE_MAX_AGE_MS = 30_000;
const LIVE_POLL_INTERVAL_MS = 15_000;
const MARK_BROADCAST_MS = 750;
const MARK_PERSIST_MS = 5_000;
const EQUITY_BROADCAST_MS = 2_000;
const EQUITY_PERSIST_MS = 10_000;

function brokerIdOf(state: OrderState): string | null {
  if (!("brokerOrderId" in state)) return null;
  return state.brokerOrderId ?? null;
}

function toLegFill(fill: {
  contractSymbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  referenceMid: number;
  multiplier: number;
  feesUsd: number;
  slippageUsd: number;
  filledAt: string;
}): LegFill {
  return {
    contractSymbol: fill.contractSymbol,
    side: fill.side,
    quantity: fill.quantity,
    multiplier: fill.multiplier,
    referenceMid: fill.referenceMid,
    fillPrice: fill.price,
    feesUsd: fill.feesUsd,
    slippageUsd: fill.slippageUsd,
    at: fill.filledAt,
  };
}

function reverseLegs(legs: readonly ScannerLeg[]): ScannerLeg[] {
  return legs.map((leg) => ({
    ...leg,
    side: leg.side === "buy" ? "sell" : "buy",
  }));
}

export class ExecutionEngine {
  private readonly store: ExecutionStore;
  private readonly broker: BrokerPort;
  private readonly market: ScannerMarketData;
  private readonly setups: SetupSource;
  private readonly optionQuotes?: OptionQuoteSource;
  private readonly now: () => Date;
  private readonly logger: (message: string) => void;
  private readonly unsubscribe: () => void;
  private readonly exitReasons = new Map<string, ExitReason>();

  private readonly liveQuotes = new Map<
    string,
    { quote: OptionQuote; seenAt: number }
  >();
  private readonly liveMarks = new Map<string, ExecutionMark>();
  private readonly markListeners = new Set<(event: ExecutionMarkEvent) => void>();
  private readonly lastBroadcastAt = new Map<string, number>();
  private readonly lastPersistAt = new Map<string, number>();
  private readonly subscribedOptionSymbols = new Set<string>();
  private readonly onOptionQuote = (quote: OptionQuote) => this.handleOptionQuote(quote);

  private liveTimer: NodeJS.Timeout | null = null;
  private liveBusy = false;
  private equityBusy = false;
  private lastPollAt = 0;
  private pollCursor = 0;
  private lastEquityAt = 0;
  private lastEquityPersistAt = 0;
  private liveEquity: EquitySnapshot | null = null;
  private lastMarkSource: "stream" | "poll" | null = null;

  constructor(options: ExecutionEngineOptions) {
    this.store = options.store;
    this.broker = options.broker;
    this.market = options.market;
    this.setups = options.setups;
    this.optionQuotes = options.optionQuotes;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? ((message) => console.warn(`[execution] ${message}`));
    this.unsubscribe = this.broker.subscribe((update) => this.handleUpdate(update));
  }

  stop(): void {
    this.stopLiveMarks();
    this.unsubscribe();
  }

  /**
   * Poll the open trades for marks and keep option subscriptions in sync.
   * Runs independently of automation so unrealized P&L stays current while
   * automation is paused (during a regular session only).
   */
  startLiveMarks(): void {
    if (this.liveTimer) return;
    this.liveTimer = setInterval(() => {
      void this.liveMarkTick();
    }, LIVE_MARK_INTERVAL_MS);
    this.liveTimer.unref?.();
    void this.liveMarkTick();
  }

  stopLiveMarks(): void {
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.liveTimer = null;
    if (this.subscribedOptionSymbols.size > 0) {
      this.optionQuotes?.unsubscribe(this.onOptionQuote);
      this.subscribedOptionSymbols.clear();
    }
  }

  /** Stream mark/equity updates to an SSE client. */
  subscribeMarks(listener: (event: ExecutionMarkEvent) => void): () => void {
    this.markListeners.add(listener);
    return () => {
      this.markListeners.delete(listener);
    };
  }

  /** Current marks and live status without touching the network. */
  markSnapshot(): {
    marks: Record<string, ExecutionMark | null>;
    equity: EquitySnapshot | null;
    live: ExecutionLiveStatus;
  } {
    const open = this.store.listOpenTrades().filter((trade) => trade.status === "open");
    const marks: Record<string, ExecutionMark | null> = {};
    for (const trade of open) {
      marks[trade.id] = this.liveMarks.get(trade.id) ?? this.store.listMarks(trade.id, 1)[0] ?? null;
    }
    return {
      marks,
      equity: this.liveEquity ?? this.store.latestEquity(),
      live: this.liveStatus(open),
    };
  }

  /** Manual paper entry; automation uses the same locked pipeline. */
  async enter(opportunityId: string): Promise<ExecutionResult<ExecutionTrade>> {
    const owner = this.store.newOwner();
    if (!this.store.acquireLease(owner, LEASE_MS)) {
      return err({ kind: "busy", message: "Another execution operation is in progress" });
    }
    try {
      return await this.enterLocked(opportunityId);
    } finally {
      this.store.releaseLease(owner);
      this.syncOptionSubscriptions();
    }
  }

  private async enterLocked(opportunityId: string): Promise<ExecutionResult<ExecutionTrade>> {
    try {
      const setup = this.setups.find(opportunityId);
      if (!setup) return err({ kind: "not_found", message: "Opportunity not found" });
      if (setup.state !== "entry_ready") {
        return err({
          kind: "setup_not_ready",
          state: setup.state,
          message: `Setup is ${setup.state}; paper entries require entry_ready`,
        });
      }

      const existing = this.store.findByOpportunity(opportunityId);
      if (existing && existing.status !== "rejected" && existing.status !== "cancelled") {
        return err({
          kind: "already_traded",
          tradeId: existing.id,
          message: "This setup already has a paper trade",
        });
      }

      const config = this.store.getConfig();
      const open = this.store.listOpenTrades();
      if (open.length >= config.limits.maxOpenTrades) {
        return err({ kind: "invalid_state", message: "Open paper trade limit reached" });
      }
      if (open.filter((trade) => trade.symbol === setup.symbol).length >= config.limits.maxPerSymbol) {
        return err({ kind: "invalid_state", message: "Per-symbol paper trade limit reached" });
      }

      const tradeId = randomUUID();
      const clientOrderId = asClientOrderId(`${tradeId}:entry`);
      const priced = await this.priceRequest(setup, setup.legs, "open", config, clientOrderId);
      if (!priced.ok) return priced;
      this.store.createTrade({
        id: tradeId,
        opportunityId: setup.id,
        identityKey: setup.identityKey,
        symbol: setup.symbol,
        horizon: setup.horizon,
        strategy: setup.strategy,
        setup,
      });
      this.store.createOrder({
        clientOrderId,
        tradeId,
        intent: "entry",
        request: priced.value,
      });
      this.store.updateTrade(tradeId, { status: "pending_entry", entryOrderId: clientOrderId });

      const submitted = await this.broker.submit(priced.value);
      if (!submitted.ok) {
        return err(this.failEntry(tradeId, clientOrderId, submitted.error));
      }

      const trade = this.store.findTrade(tradeId)!;
      if (trade.status === "rejected") {
        const order = this.store.findOrder(clientOrderId);
        return err({
          kind: "broker",
          error:
            order?.state.status === "rejected"
              ? order.state.error
              : { kind: "rejected", code: "rejected", message: "Paper entry was rejected" },
        });
      }
      return ok(trade);
    } catch (error) {
      return err({
        kind: "internal",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async close(
    tradeId: string,
    reason: ExitReason = { kind: "manual", actor: "user" }
  ): Promise<ExecutionResult<ExecutionTrade>> {
    const owner = this.store.newOwner();
    if (!this.store.acquireLease(owner, LEASE_MS)) {
      return err({ kind: "busy", message: "Another execution operation is in progress" });
    }
    try {
      const result = await this.closeLocked(tradeId, reason);
      if (result.ok) await this.publishEquity(this.now(), true);
      return result;
    } finally {
      this.store.releaseLease(owner);
      this.syncOptionSubscriptions();
    }
  }

  private async closeLocked(
    tradeId: string,
    reason: ExitReason
  ): Promise<ExecutionResult<ExecutionTrade>> {
    try {
      const trade = this.store.findTrade(tradeId);
      if (!trade) return err({ kind: "not_found", message: "Trade not found" });
      if (trade.status === "closed" || trade.status === "cancelled" || trade.status === "rejected") {
        return err({ kind: "invalid_state", message: `Trade is already ${trade.status}` });
      }
      if (trade.status !== "open") {
        return err({ kind: "invalid_state", message: "Trade is not open" });
      }
      if (trade.setup.legs.length === 0) {
        return err({ kind: "invalid_state", message: "Trade has no legs to close" });
      }

      const config = this.store.getConfig();
      const exitLegs = reverseLegs(trade.setup.legs);
      const clientOrderId = asClientOrderId(`${tradeId}:exit:${randomUUID().slice(0, 8)}`);
      const priced = await this.priceRequest(trade.setup, exitLegs, "close", config, clientOrderId);
      if (!priced.ok) return priced;

      this.exitReasons.set(clientOrderId, reason);
      this.store.createOrder({
        clientOrderId,
        tradeId,
        intent: "exit",
        request: priced.value,
      });
      this.store.updateTrade(tradeId, { status: "pending_exit", exitOrderId: clientOrderId });
      this.store.appendEvent({
        tradeId,
        type: "exit_requested",
        dedupeKey: `exit:${tradeId}:${clientOrderId}`,
        payload: { reason },
        createdAt: this.now().toISOString(),
      });

      const submitted = await this.broker.submit(priced.value);
      if (!submitted.ok) {
        this.exitReasons.delete(clientOrderId);
        this.failExit(tradeId, clientOrderId, submitted.error);
        return err({ kind: "broker", error: submitted.error });
      }

      const updated = this.store.findTrade(tradeId)!;
      const exitOrder = this.store.findOrder(clientOrderId);
      if (updated.status === "open" && exitOrder?.state.status === "rejected") {
        return err({ kind: "broker", error: exitOrder.state.error });
      }
      return ok(updated);
    } catch (error) {
      return err({
        kind: "internal",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  listTrades(filters: { status?: ExecutionTradeStatus; limit?: number } = {}): ExecutionTrade[] {
    return this.store.listTrades(filters);
  }

  getTrade(tradeId: string) {
    const trade = this.store.findTrade(tradeId);
    if (!trade) return null;
    return {
      trade,
      orders: this.store.listOrders(tradeId),
      fills: this.store.listFills(tradeId),
      marks: this.store.listMarks(tradeId),
      events: this.store.listEvents(tradeId),
    };
  }

  async status(): Promise<ExecutionStatus> {
    const snapshot = await this.broker.snapshot();
    const openTrades = this.store.listOpenTrades();
    return {
      config: this.store.getConfig(),
      counts: this.store.counts(),
      openTrades,
      latestMarks: Object.fromEntries(
        openTrades.map((trade) => [
          trade.id,
          this.liveMarks.get(trade.id) ?? this.store.listMarks(trade.id, 1)[0] ?? null,
        ])
      ),
      equity: this.liveEquity ?? this.store.latestEquity(),
      live: this.liveStatus(openTrades),
      broker: snapshot.ok
        ? { ok: true, cashUsd: snapshot.value.cashUsd, positions: snapshot.value.positions }
        : { ok: false, error: snapshot.error },
    };
  }

  /**
   * One automation pass: exits first (to free slots), then entries, then marks.
   * The scheduler owns session and cadence; this method owns the lease.
   */
  async automate(now = this.now()): Promise<AutomationOutcome> {
    const config = this.store.getConfig();
    if (!config.enabled) return { status: "disabled" };

    const owner = this.store.newOwner();
    if (!this.store.acquireLease(owner, 120_000)) return { status: "overlap" };

    try {
      let exits = 0;
      let entries = 0;
      if (config.automation.exits) exits = await this.runExits(now, config);
      if (config.automation.entries) entries = await this.runEntries(config);
      const marks = await this.markOpenTrades(now);
      return { status: "completed", exits, entries, marks };
    } finally {
      this.store.releaseLease(owner);
      this.syncOptionSubscriptions();
    }
  }

  /**
   * Restart recovery for the paper adapter: its in-memory orders cannot be
   * resumed, so pending trades are cancelled and their open orders rejected.
   * A live adapter will reconcile against `BrokerPort.snapshot()` instead.
   */
  recover(now = this.now()): number {
    this.store.clearLease();
    let recovered = 0;
    for (const trade of this.store.listPendingTrades()) {
      for (const order of this.store.listOrders(trade.id)) {
        const state = order.state;
        const at = now.toISOString();
        if (state.status === "submitted") {
          const next = applyBrokerUpdate(state, {
            kind: "rejected",
            clientOrderId: asClientOrderId(order.clientOrderId),
            brokerOrderId: null,
            error: {
              kind: "unknown",
              message: "Execution process restarted before the order was acknowledged",
            },
            at,
          });
          if (next.ok) {
            this.store.updateOrder(order.clientOrderId, {
              state: next.value,
              status: next.value.status,
              brokerOrderId: brokerIdOf(next.value),
            });
          }
        } else if (state.status === "acknowledged" || state.status === "partially_filled") {
          const next = applyBrokerUpdate(state, {
            kind: "cancelled",
            clientOrderId: asClientOrderId(order.clientOrderId),
            brokerOrderId: state.brokerOrderId,
            at,
          });
          if (next.ok) {
            this.store.updateOrder(order.clientOrderId, {
              state: next.value,
              status: next.value.status,
              brokerOrderId: brokerIdOf(next.value),
            });
          }
        }
      }
      this.store.updateTrade(trade.id, { status: "cancelled" });
      this.store.appendEvent({
        tradeId: trade.id,
        type: "recovered_after_restart",
        dedupeKey: `trade:${trade.id}:recovered`,
        payload: { note: "Paper broker state is not persisted across restarts" },
        createdAt: now.toISOString(),
      });
      recovered += 1;
    }
    return recovered;
  }

  private async runExits(now: Date, config: ExecutionConfig): Promise<number> {
    let exited = 0;
    for (const trade of this.store.listOpenTrades()) {
      const setup = this.setups.find(trade.opportunityId);
      const close = await this.closeQuote(trade);
      const decision = evaluateExit({
        trade,
        setupState: setup?.state ?? null,
        closeNetPerShare: close?.net ?? null,
        now,
        config,
      });

      if (!decision.reason) {
        if (decision.unable) {
          this.store.appendEvent({
            tradeId: trade.id,
            type: "exit_unable",
            dedupeKey: `exit-unable:${trade.id}:${Math.floor(now.getTime() / 60_000)}`,
            payload: { reason: decision.unable },
            createdAt: now.toISOString(),
          });
        }
        continue;
      }

      const result = await this.closeLocked(trade.id, decision.reason);
      if (result.ok) exited += 1;
      else this.logger(`Automated exit skipped for ${trade.id}: ${result.error.kind}`);
    }
    return exited;
  }

  private async runEntries(config: ExecutionConfig): Promise<number> {
    let entered = 0;
    for (const setup of this.setups.listEntryReady()) {
      const open = this.store.listOpenTrades();
      if (open.length >= config.limits.maxOpenTrades) break;
      // The per-symbol cap is expected to block duplicates; skip quietly.
      if (open.some((trade) => trade.symbol === setup.symbol)) continue;
      const existing = this.store.findByOpportunity(setup.id);
      if (existing && existing.status !== "rejected" && existing.status !== "cancelled") continue;
      const result = await this.enterLocked(setup.id);
      if (result.ok) entered += 1;
      else this.logger(`Automated entry skipped for ${setup.symbol}: ${result.error.kind}`);
    }
    return entered;
  }

  private async markOpenTrades(now: Date): Promise<number> {
    const open = this.store.listOpenTrades().filter((trade) => trade.status === "open");
    let marked = 0;

    for (const trade of open) {
      const touch = await this.touchForMark(trade, now);
      if (!touch) continue;
      this.publishMark(this.markFromTouch(trade, touch, now), now, touch.source, true);
      marked += 1;
    }

    await this.publishEquity(now, true);
    return marked;
  }

  /**
   * The live loop runs even when automation is paused. It prefers fresh
   * streamed option quotes and falls back to polling each open trade's chain
   * every `LIVE_POLL_INTERVAL_MS` (at most two chains per pass).
   */
  private async liveMarkTick(): Promise<void> {
    if (this.liveBusy) return;
    this.liveBusy = true;
    try {
      const now = this.now();
      const open = this.store.listOpenTrades().filter((trade) => trade.status === "open");

      if (open.length === 0 || sessionState(now).state !== "open") {
        this.syncOptionSubscriptions([]);
        this.liveQuotes.clear();
        return;
      }

      this.syncOptionSubscriptions(open);
      const missing: ExecutionTrade[] = [];

      for (const trade of open) {
        const touch = this.touchFromLive(trade, now);
        if (!touch) {
          missing.push(trade);
          continue;
        }
        this.publishMark(this.markFromTouch(trade, touch, now), now, "stream", false);
      }

      if (missing.length > 0 && now.getTime() - this.lastPollAt >= LIVE_POLL_INTERVAL_MS) {
        this.lastPollAt = now.getTime();
        // Rotate the batch so more than two open trades still get polled.
        const start = this.pollCursor % missing.length;
        const batch = [...missing.slice(start), ...missing.slice(0, start)].slice(0, 2);
        this.pollCursor += 1;
        await mapWithConcurrency(batch, 2, async (trade) => {
          const touch = await this.touchFromChain(trade);
          if (!touch) return;
          this.publishMark(this.markFromTouch(trade, touch, now), now, "poll", false);
        });
      }

      await this.publishEquity(now);
    } catch (error) {
      this.logger(
        `Live mark tick failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.liveBusy = false;
    }
  }

  private handleOptionQuote(quote: OptionQuote): void {
    if (!quote.symbol) return;
    const now = this.now();
    this.liveQuotes.set(quote.symbol, { quote, seenAt: now.getTime() });

    for (const trade of this.store.listOpenTrades()) {
      if (trade.status !== "open") continue;
      const touch = this.touchFromLive(trade, now);
      if (touch) this.publishMark(this.markFromTouch(trade, touch, now), now, "stream", false);
    }
    void this.publishEquity(now);
  }

  private syncOptionSubscriptions(open = this.store.listOpenTrades()): void {
    const openIds = new Set(
      open.filter((trade) => trade.status === "open").map((trade) => trade.id)
    );
    for (const id of this.liveMarks.keys()) {
      if (openIds.has(id)) continue;
      this.liveMarks.delete(id);
      this.lastBroadcastAt.delete(id);
      this.lastPersistAt.delete(id);
    }
    if (!this.optionQuotes) return;

    const symbols = new Set<string>();
    for (const trade of open) {
      if (trade.status !== "open") continue;
      for (const leg of trade.setup.legs) symbols.add(leg.contractSymbol);
    }

    let unchanged = symbols.size === this.subscribedOptionSymbols.size;
    if (unchanged) {
      for (const symbol of symbols) {
        if (!this.subscribedOptionSymbols.has(symbol)) {
          unchanged = false;
          break;
        }
      }
    }
    if (unchanged) return;

    this.subscribedOptionSymbols.clear();
    for (const symbol of symbols) this.subscribedOptionSymbols.add(symbol);

    if (symbols.size === 0) {
      this.optionQuotes.unsubscribe(this.onOptionQuote);
      this.liveQuotes.clear();
      return;
    }
    this.optionQuotes.subscribe([...symbols], this.onOptionQuote);
  }

  private touchFromLive(
    trade: ExecutionTrade,
    now: Date
  ): { net: number; underlyingPrice: number | null } | null {
    const quotes = new Map<
      string,
      {
        contractSymbol: string;
        bid: number | null;
        ask: number | null;
        quoteTime: string | null;
        multiplier: number;
      }
    >();
    let underlyingPrice: number | null = null;

    for (const leg of trade.setup.legs) {
      const cached = this.liveQuotes.get(leg.contractSymbol);
      if (!cached) return null;
      if (now.getTime() - cached.seenAt > LIVE_QUOTE_MAX_AGE_MS) return null;
      if (cached.quote.bid === null || cached.quote.ask === null) return null;
      if (underlyingPrice === null && cached.quote.underlyingPrice !== null) {
        underlyingPrice = cached.quote.underlyingPrice;
      }
      quotes.set(leg.contractSymbol, {
        contractSymbol: leg.contractSymbol,
        bid: cached.quote.bid,
        ask: cached.quote.ask,
        quoteTime:
          cached.quote.quoteTime === null
            ? null
            : new Date(cached.quote.quoteTime * 1000).toISOString(),
        multiplier: cached.quote.multiplier ?? leg.multiplier,
      });
    }

    const net = packageTouchPrice(reverseLegs(trade.setup.legs), quotes);
    return net.ok ? { net: net.value, underlyingPrice } : null;
  }

  private async touchFromChain(
    trade: ExecutionTrade
  ): Promise<{ net: number; underlyingPrice: number | null } | null> {
    try {
      const chain = await this.market.chain(trade.setup.symbol, trade.setup.expiry, {
        fresh: true,
      });
      const quotes = quotesFromChain(chain);
      const net = packageTouchPrice(reverseLegs(trade.setup.legs), quotes);
      if (!net.ok) return null;
      return { net: net.value, underlyingPrice: chain.underlyingPrice };
    } catch {
      return null;
    }
  }

  private async touchForMark(
    trade: ExecutionTrade,
    now: Date
  ): Promise<{
    net: number;
    underlyingPrice: number | null;
    source: "stream" | "poll";
  } | null> {
    const live = this.touchFromLive(trade, now);
    if (live) return { ...live, source: "stream" };
    const chain = await this.touchFromChain(trade);
    return chain ? { ...chain, source: "poll" } : null;
  }

  private markFromTouch(
    trade: ExecutionTrade,
    touch: { net: number; underlyingPrice: number | null },
    now: Date
  ): ExecutionMark {
    const multiplier =
      trade.entrySummary?.legs[0]?.multiplier ?? trade.setup.legs[0]?.multiplier ?? 100;
    return {
      tradeId: trade.id,
      markedAt: now.toISOString(),
      liquidationValueUsd: roundMoney(-touch.net * multiplier),
      underlyingPrice: touch.underlyingPrice,
    };
  }

  private publishMark(
    mark: ExecutionMark,
    now: Date,
    source: "stream" | "poll",
    force: boolean
  ): void {
    this.lastMarkSource = source;
    this.liveMarks.set(mark.tradeId, mark);

    const broadcastAt = this.lastBroadcastAt.get(mark.tradeId) ?? 0;
    if (force || now.getTime() - broadcastAt >= MARK_BROADCAST_MS) {
      this.lastBroadcastAt.set(mark.tradeId, now.getTime());
      for (const listener of this.markListeners) {
        try {
          listener({ type: "mark", mark });
        } catch {
          // A broken SSE client must never affect execution.
        }
      }
    }

    // The live stream can tick many times per second; persist at a bounded
    // cadence so the marks table stays useful without exploding in size.
    const persistAt = this.lastPersistAt.get(mark.tradeId) ?? 0;
    if (force || now.getTime() - persistAt >= MARK_PERSIST_MS) {
      this.store.recordMark(mark);
      this.lastPersistAt.set(mark.tradeId, now.getTime());
    }
  }

  private async publishEquity(now = this.now(), force = false): Promise<void> {
    if (this.equityBusy) return;
    if (!force && now.getTime() - this.lastEquityAt < EQUITY_BROADCAST_MS) return;

    this.equityBusy = true;
    try {
      const snapshot = await this.broker.snapshot();
      if (!snapshot.ok) return;

      let positionsUsd = 0;
      for (const trade of this.store.listOpenTrades()) {
        if (trade.status !== "open") continue;
        const mark = this.liveMarks.get(trade.id) ?? this.store.listMarks(trade.id, 1)[0] ?? null;
        if (mark) positionsUsd += mark.liquidationValueUsd;
      }

      const equity: EquitySnapshot = {
        asOf: now.toISOString(),
        cashUsd: snapshot.value.cashUsd,
        positionsUsd: roundMoney(positionsUsd),
        equityUsd: roundMoney(snapshot.value.cashUsd + positionsUsd),
      };
      this.liveEquity = equity;
      this.lastEquityAt = now.getTime();

      for (const listener of this.markListeners) {
        try {
          listener({ type: "equity", equity });
        } catch {
          // Ignore subscriber failures.
        }
      }

      if (force || now.getTime() - this.lastEquityPersistAt >= EQUITY_PERSIST_MS) {
        this.store.recordEquity(equity);
        this.lastEquityPersistAt = now.getTime();
      }
    } finally {
      this.equityBusy = false;
    }
  }

  private liveStatus(open = this.store.listOpenTrades()): ExecutionLiveStatus {
    let lastMarkAt: string | null = null;
    for (const trade of open) {
      const mark = this.liveMarks.get(trade.id);
      if (mark && (lastMarkAt === null || mark.markedAt > lastMarkAt)) {
        lastMarkAt = mark.markedAt;
      }
    }
    return {
      streaming: Boolean(this.optionQuotes?.streaming?.()),
      source: this.lastMarkSource,
      lastMarkAt,
    };
  }

  private async closeQuote(
    trade: ExecutionTrade
  ): Promise<{ net: number; underlyingPrice: number | null } | null> {
    return this.touchFromLive(trade, this.now()) ?? this.touchFromChain(trade);
  }

  private async priceRequest(
    setup: OpportunityRecord,
    legs: readonly ScannerLeg[],
    intent: "open" | "close",
    config: ExecutionConfig,
    clientOrderId: ReturnType<typeof asClientOrderId>
  ): Promise<ExecutionResult<BrokerOrderRequest>> {
    let chain: NormalizedChain;
    try {
      chain = await this.market.chain(setup.symbol, setup.expiry);
    } catch (error) {
      return err({
        kind: "market_data",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const quotes = quotesFromChain(chain);
    const limit = packageLimitPrice(legs, quotes, config.quotes.limitBufferPct);
    if (!limit.ok) {
      return err({
        kind: "market_data",
        message:
          limit.error.kind === "missing_quote"
            ? `No current quote for ${limit.error.contractSymbol}`
            : limit.error.message,
      });
    }

    return ok({
      clientOrderId,
      intent,
      assetClass: "option",
      instrument: { underlying: setup.symbol, expiry: setup.expiry },
      legs: legs.map((leg) => ({
        contractSymbol: leg.contractSymbol,
        side: leg.side,
        quantity: leg.quantity,
      })),
      orderType: "limit",
      netLimitPrice: limit.value,
      timeInForce: "day",
    });
  }

  private failEntry(tradeId: string, clientOrderId: string, error: BrokerError): ExecutionError {
    const order = this.store.findOrder(clientOrderId);
    if (order) {
      const rejected = applyBrokerUpdate(order.state, {
        kind: "rejected",
        clientOrderId: asClientOrderId(clientOrderId),
        brokerOrderId: null,
        error,
        at: this.now().toISOString(),
      });
      if (rejected.ok) {
        this.store.updateOrder(clientOrderId, {
          state: rejected.value,
          status: rejected.value.status,
        });
      }
    }
    this.store.updateTrade(tradeId, { status: "rejected" });
    this.store.appendEvent({
      tradeId,
      type: "entry_rejected",
      dedupeKey: `trade:${tradeId}:entry_rejected`,
      payload: { error },
      createdAt: this.now().toISOString(),
    });
    return { kind: "broker", error };
  }

  private failExit(tradeId: string, clientOrderId: string, error: BrokerError): void {
    const order = this.store.findOrder(clientOrderId);
    if (order) {
      const rejected = applyBrokerUpdate(order.state, {
        kind: "rejected",
        clientOrderId: asClientOrderId(clientOrderId),
        brokerOrderId: null,
        error,
        at: this.now().toISOString(),
      });
      if (rejected.ok) {
        this.store.updateOrder(clientOrderId, {
          state: rejected.value,
          status: rejected.value.status,
        });
      }
    }
    this.store.updateTrade(tradeId, { status: "open" });
    this.store.appendEvent({
      tradeId,
      type: "exit_rejected",
      dedupeKey: `trade:${tradeId}:exit_rejected:${clientOrderId}`,
      payload: { error },
      createdAt: this.now().toISOString(),
    });
  }

  private handleUpdate(update: BrokerOrderUpdate): void {
    try {
      const order = this.store.findOrder(update.clientOrderId);
      if (!order) {
        this.logger(`Received update for unknown order ${update.clientOrderId}`);
        return;
      }

      const transition = applyBrokerUpdate(order.state, update);
      if (!transition.ok) {
        this.logger(`Ignored invalid order update: ${transition.error.message}`);
        this.store.appendEvent({
          tradeId: order.tradeId,
          type: "order_transition_error",
          dedupeKey: `order:${update.clientOrderId}:invalid:${update.kind}:${update.at}`,
          payload: { message: transition.error.message },
          createdAt: update.at,
        });
        return;
      }

      this.store.runInTransaction(() => {
        this.store.updateOrder(update.clientOrderId, {
          state: transition.value,
          status: transition.value.status,
          brokerOrderId: brokerIdOf(transition.value),
        });
        this.store.appendEvent({
          tradeId: order.tradeId,
          type: `order_${update.kind}`,
          dedupeKey: `order:${update.clientOrderId}:${update.kind}:${update.at}`,
          payload: { status: transition.value.status },
          createdAt: update.at,
        });

        if (update.kind === "fill") {
          this.persistFill(order.tradeId, update, transition.value.status === "filled");
          return;
        }
        if (update.kind === "rejected") {
          if (order.intent === "entry") {
            this.store.updateTrade(order.tradeId, { status: "rejected" });
          } else {
            this.store.updateTrade(order.tradeId, { status: "open" });
          }
          return;
        }
        if (update.kind === "cancelled" || update.kind === "expired") {
          if (order.intent === "entry") {
            this.store.updateTrade(order.tradeId, { status: "cancelled" });
          } else {
            this.store.updateTrade(order.tradeId, { status: "open" });
          }
        }
      });
    } catch (error) {
      this.logger(
        `Failed to persist order update ${update.clientOrderId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private persistFill(
    tradeId: string,
    update: Extract<BrokerOrderUpdate, { kind: "fill" }>,
    filled: boolean
  ): void {
    const inserted = update.fills.map((fill) => ({
      fillId: fill.fillId,
      clientOrderId: update.clientOrderId,
      tradeId,
      contractSymbol: fill.contractSymbol,
      side: fill.side,
      quantity: fill.quantity,
      price: fill.price,
      referenceMid: fill.referenceMid,
      multiplier: fill.multiplier,
      slippageUsd: roundMoney(
        legSlippage(fill.side, fill.price, fill.referenceMid, fill.quantity, fill.multiplier)
      ),
      feesUsd: fill.feesUsd,
      filledAt: fill.at,
    }));
    this.store.insertFills(inserted);
    if (!filled) return;

    const orderFills = this.store.listOrderFills(update.clientOrderId);
    const summary = summarizeLegFills(orderFills.map(toLegFill));
    if (!summary.ok) {
      this.logger(`Unable to summarize fill for ${update.clientOrderId}: ${summary.error.message}`);
      return;
    }

    const order = this.store.findOrder(update.clientOrderId);
    if (!order) return;

    if (order.intent === "entry") {
      this.store.updateTrade(tradeId, {
        status: "open",
        entrySummary: summary.value,
        openedAt: update.at,
      });
      this.store.appendEvent({
        tradeId,
        type: "trade_opened",
        dedupeKey: `trade:${tradeId}:opened`,
        payload: {
          netPricePerShare: summary.value.netPricePerShare,
          feesUsd: summary.value.feesUsd,
          slippageUsd: summary.value.slippageUsd,
        },
        createdAt: update.at,
      });
      return;
    }

    const trade = this.store.findTrade(tradeId);
    if (!trade?.entrySummary) {
      this.logger(`Exit filled without an entry summary for ${tradeId}`);
      return;
    }
    const pnl = computeTradePnl(trade.entrySummary, summary.value);
    if (!pnl.ok) {
      this.logger(`Unable to compute P&L for ${tradeId}: ${pnl.error.message}`);
      return;
    }
    this.store.updateTrade(tradeId, {
      status: "closed",
      exitSummary: summary.value,
      pnl: pnl.value,
      closedAt: update.at,
    });
    this.store.appendEvent({
      tradeId,
      type: "trade_closed",
      dedupeKey: `trade:${tradeId}:closed`,
      payload: { pnl: pnl.value, reason: this.exitReasons.get(update.clientOrderId) ?? null },
      createdAt: update.at,
    });
    this.exitReasons.delete(update.clientOrderId);
  }
}
