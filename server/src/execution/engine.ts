import { randomUUID } from "node:crypto";
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
import { packageLimitPrice, quotesFromChain } from "./pricing.js";
import type { ExecutionStore } from "./store.js";
import type {
  ExecutionError,
  ExecutionResult,
  ExecutionStatus,
  ExecutionTrade,
  ExecutionTradeStatus,
  SetupSource,
} from "./types.js";

export type ExecutionEngineOptions = {
  store: ExecutionStore;
  broker: BrokerPort;
  market: ScannerMarketData;
  setups: SetupSource;
  now?: () => Date;
  logger?: (message: string) => void;
};

const LEASE_MS = 30_000;

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
  private readonly now: () => Date;
  private readonly logger: (message: string) => void;
  private readonly unsubscribe: () => void;

  constructor(options: ExecutionEngineOptions) {
    this.store = options.store;
    this.broker = options.broker;
    this.market = options.market;
    this.setups = options.setups;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? ((message) => console.warn(`[execution] ${message}`));
    this.unsubscribe = this.broker.subscribe((update) => this.handleUpdate(update));
  }

  stop(): void {
    this.unsubscribe();
  }

  /**
   * Manual paper entry. The scanner lifecycle must already be `entry_ready`;
   * the same pipeline will drive automated entries in a later phase.
   */
  async enter(opportunityId: string): Promise<ExecutionResult<ExecutionTrade>> {
    const owner = this.store.newOwner();
    if (!this.store.acquireLease(owner, LEASE_MS)) {
      return err({ kind: "busy", message: "Another execution operation is in progress" });
    }

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
    } finally {
      this.store.releaseLease(owner);
    }
  }

  async close(tradeId: string): Promise<ExecutionResult<ExecutionTrade>> {
    const owner = this.store.newOwner();
    if (!this.store.acquireLease(owner, LEASE_MS)) {
      return err({ kind: "busy", message: "Another execution operation is in progress" });
    }

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
      this.store.createOrder({
        clientOrderId,
        tradeId,
        intent: "exit",
        request: priced.value,
      });
      this.store.updateTrade(tradeId, { status: "pending_exit", exitOrderId: clientOrderId });

      const submitted = await this.broker.submit(priced.value);
      if (!submitted.ok) {
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
    } finally {
      this.store.releaseLease(owner);
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
      events: this.store.listEvents(tradeId),
    };
  }

  async status(): Promise<ExecutionStatus> {
    const snapshot = await this.broker.snapshot();
    return {
      config: this.store.getConfig(),
      counts: this.store.counts(),
      openTrades: this.store.listOpenTrades(),
      broker: snapshot.ok
        ? { ok: true, cashUsd: snapshot.value.cashUsd, positions: snapshot.value.positions }
        : { ok: false, error: snapshot.error },
    };
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
      payload: { pnl: pnl.value },
      createdAt: update.at,
    });
  }
}
