import type { BrokerOrderRequest, Result } from "../../ports/broker.js";
import { err, ok } from "../../ports/broker.js";
import { legSlippage, summarizeLegFills, type FillSummary, type LegFill } from "../../domain/fill.js";

/**
 * Deterministic paper fill model. It is intentionally adapter-local: a live
 * broker returns real fills and never uses this module.
 */

export type FillModelQuote = {
  contractSymbol: string;
  bid: number | null;
  ask: number | null;
  quoteTime: string | null;
  multiplier: number | null;
};

export type FillModelConfig = {
  /** 1 = cross the full bid/ask spread; 0 = fill at the mid. */
  spreadFactor: number;
  /** Additional adverse price in basis points of the mid. */
  impactBps: number;
  /** Optional deterministic jitter, ± this value in basis points. */
  jitterBps: number;
  maxSlippagePct: number;
  maxQuoteAgeMs: number;
  fees: {
    perOrderUsd: number;
    perContractUsd: number;
  };
};

export type FillModelInput = {
  request: BrokerOrderRequest;
  quotes: ReadonlyMap<string, FillModelQuote>;
  now: Date;
  config: FillModelConfig;
  /** Deterministic jitter seed, normally the trade id. */
  seed: string;
};

export type ModeledFill = {
  legs: readonly LegFill[];
  summary: FillSummary;
};

export type FillModelError =
  | { kind: "invalid_config"; message: string }
  | { kind: "unsupported_asset"; assetClass: string }
  | { kind: "missing_quote"; contractSymbol: string }
  | { kind: "stale_quote"; contractSymbol: string; ageSeconds: number }
  | { kind: "invalid_quote"; contractSymbol: string; message: string }
  | { kind: "non_positive_price"; contractSymbol: string }
  | { kind: "slippage_limit"; contractSymbol: string | null; slippagePct: number; maxPct: number }
  | { kind: "invalid_fill"; message: string };

function validConfig(config: FillModelConfig): string | null {
  const nonNegative = [
    config.spreadFactor,
    config.impactBps,
    config.jitterBps,
    config.maxSlippagePct,
    config.maxQuoteAgeMs,
    config.fees.perOrderUsd,
    config.fees.perContractUsd,
  ];
  if (nonNegative.some((value) => !Number.isFinite(value) || value < 0)) {
    return "slippage and fee settings must be finite and non-negative";
  }
  if (config.maxQuoteAgeMs <= 0) return "maxQuoteAgeMs must be positive";
  return null;
}

function hashString(input: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** Mulberry32: small, deterministic, good enough for seeded jitter. */
function unitInterval(seed: string): number {
  let state = hashString(seed) + 0x6d2b79f5;
  let value = Math.imul(state ^ (state >>> 15), state | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
}

function validateQuote(
  quote: FillModelQuote,
  now: Date,
  config: FillModelConfig
): FillModelError | null {
  if (quote.bid === null || quote.ask === null) {
    return { kind: "invalid_quote", contractSymbol: quote.contractSymbol, message: "missing bid/ask" };
  }
  if (!Number.isFinite(quote.bid) || !Number.isFinite(quote.ask)) {
    return { kind: "invalid_quote", contractSymbol: quote.contractSymbol, message: "unreadable bid/ask" };
  }
  if (quote.bid <= 0 || quote.ask <= 0) {
    return {
      kind: "invalid_quote",
      contractSymbol: quote.contractSymbol,
      message: "bid/ask must be positive",
    };
  }
  if (quote.bid > quote.ask) {
    return { kind: "invalid_quote", contractSymbol: quote.contractSymbol, message: "crossed market" };
  }
  if (quote.multiplier === null || !Number.isFinite(quote.multiplier) || quote.multiplier <= 0) {
    return {
      kind: "invalid_quote",
      contractSymbol: quote.contractSymbol,
      message: "multiplier is missing",
    };
  }
  if (!quote.quoteTime) {
    return {
      kind: "invalid_quote",
      contractSymbol: quote.contractSymbol,
      message: "quote timestamp is missing",
    };
  }
  const quotedAt = Date.parse(quote.quoteTime);
  if (!Number.isFinite(quotedAt)) {
    return {
      kind: "invalid_quote",
      contractSymbol: quote.contractSymbol,
      message: "quote timestamp is unreadable",
    };
  }
  const ageSeconds = (now.getTime() - quotedAt) / 1000;
  if (ageSeconds > config.maxQuoteAgeMs / 1000) {
    return { kind: "stale_quote", contractSymbol: quote.contractSymbol, ageSeconds };
  }
  return null;
}

/**
 * Model one complete package. Legs are all-or-none: one failed quote rejects
 * the package rather than producing a partial fill.
 */
export function modelFill(input: FillModelInput): Result<ModeledFill, FillModelError> {
  const configIssue = validConfig(input.config);
  if (configIssue) return err({ kind: "invalid_config", message: configIssue });
  if (input.request.assetClass !== "option") {
    return err({ kind: "unsupported_asset", assetClass: input.request.assetClass });
  }
  if (input.request.legs.length === 0) {
    return err({ kind: "invalid_fill", message: "order has no legs" });
  }

  if (input.request.legs.length === 0) {
    return err({ kind: "invalid_fill", message: "order has no legs" });
  }

  const legs: LegFill[] = [];

  for (const [index, leg] of input.request.legs.entries()) {
    const quote = input.quotes.get(leg.contractSymbol);
    if (!quote) return err({ kind: "missing_quote", contractSymbol: leg.contractSymbol });

    const quoteIssue = validateQuote(quote, input.now, input.config);
    if (quoteIssue) return err(quoteIssue);

    const bid = quote.bid as number;
    const ask = quote.ask as number;
    const multiplier = quote.multiplier as number;
    const mid = (bid + ask) / 2;
    const halfSpread = (ask - bid) / 2;
    const spreadCost = halfSpread * input.config.spreadFactor;
    const impact = mid * (input.config.impactBps / 10_000);
    const jitter =
      (unitInterval(`${input.seed}:${leg.contractSymbol}:${leg.side}:${index}`) - 0.5) *
      2 *
      mid *
      (input.config.jitterBps / 10_000);
    const sign = leg.side === "buy" ? 1 : -1;
    const fillPrice = mid + sign * (spreadCost + impact + jitter);

    if (!Number.isFinite(fillPrice) || fillPrice <= 0) {
      return err({ kind: "non_positive_price", contractSymbol: leg.contractSymbol });
    }

    const slippagePct = (Math.abs(fillPrice - mid) / mid) * 100;
    if (slippagePct > input.config.maxSlippagePct) {
      return err({
        kind: "slippage_limit",
        contractSymbol: leg.contractSymbol,
        slippagePct,
        maxPct: input.config.maxSlippagePct,
      });
    }

    const feesUsd =
      (index === 0 ? input.config.fees.perOrderUsd : 0) +
      input.config.fees.perContractUsd * leg.quantity;

    legs.push({
      contractSymbol: leg.contractSymbol,
      side: leg.side,
      quantity: leg.quantity,
      multiplier,
      referenceMid: mid,
      fillPrice,
      feesUsd,
      slippageUsd: legSlippage(leg.side, fillPrice, mid, leg.quantity, multiplier),
      at: input.now.toISOString(),
    });
  }

  const summary = summarizeLegFills(legs);
  if (!summary.ok) return err({ kind: "invalid_fill", message: summary.error.message });

  if (summary.value.slippagePctOfMid > input.config.maxSlippagePct) {
    return err({
      kind: "slippage_limit",
      contractSymbol: null,
      slippagePct: summary.value.slippagePctOfMid,
      maxPct: input.config.maxSlippagePct,
    });
  }

  return ok({ legs, summary: summary.value });
}

/**
 * Marketable-limit price for the package, derived from the modeled fill and a
 * buffer. Shared with a future live adapter so both submit the same order type.
 */
export function marketableLimitPrice(
  fill: ModeledFill,
  bufferPct: number
): number {
  const sign = fill.summary.netPricePerShare >= 0 ? 1 : -1;
  const buffer = Math.abs(fill.summary.netPricePerShare) * (Math.max(0, bufferPct) / 100);
  return Math.max(0.01, Number((fill.summary.netPricePerShare + sign * buffer).toFixed(2)));
}
