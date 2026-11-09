import type { Result } from "../ports/broker.js";
import { err, ok } from "../ports/broker.js";

/**
 * Fill-level accounting shared by every adapter. A live broker and the paper
 * fill model both produce `LegFill[]`, so slippage, fees and package price are
 * computed exactly once, in one place.
 */

export type LegFill = {
  contractSymbol: string;
  side: "buy" | "sell";
  quantity: number;
  multiplier: number;
  referenceMid: number;
  fillPrice: number;
  feesUsd: number;
  slippageUsd: number;
  at: string;
};

export type FillSummary = {
  legs: readonly LegFill[];
  feesUsd: number;
  slippageUsd: number;
  /** Positive means a net debit, negative a net credit. Per share. */
  netPricePerShare: number;
  midPricePerShare: number;
  slippagePctOfMid: number;
  filledAt: string;
};

export type FillSummaryError = { kind: "invalid_fill"; message: string };

export function legSlippage(
  side: "buy" | "sell",
  fillPrice: number,
  referenceMid: number,
  quantity: number,
  multiplier: number
): number {
  const sign = side === "buy" ? 1 : -1;
  return (fillPrice - referenceMid) * sign * quantity * multiplier;
}

export function summarizeLegFills(
  legs: readonly LegFill[]
): Result<FillSummary, FillSummaryError> {
  if (legs.length === 0) {
    return err({ kind: "invalid_fill", message: "a fill must contain at least one leg" });
  }

  let feesUsd = 0;
  let slippageUsd = 0;
  let netPricePerShare = 0;
  let midPricePerShare = 0;
  let notionalMid = 0;

  for (const leg of legs) {
    if (!Number.isFinite(leg.quantity) || leg.quantity <= 0) {
      return err({
        kind: "invalid_fill",
        message: `quantity must be positive for ${leg.contractSymbol}`,
      });
    }
    if (!Number.isFinite(leg.multiplier) || leg.multiplier <= 0) {
      return err({
        kind: "invalid_fill",
        message: `multiplier must be positive for ${leg.contractSymbol}`,
      });
    }
    if (!Number.isFinite(leg.fillPrice) || leg.fillPrice <= 0) {
      return err({
        kind: "invalid_fill",
        message: `fill price must be positive for ${leg.contractSymbol}`,
      });
    }
    if (!Number.isFinite(leg.referenceMid) || leg.referenceMid <= 0) {
      return err({
        kind: "invalid_fill",
        message: `reference mid must be positive for ${leg.contractSymbol}`,
      });
    }
    if (!Number.isFinite(leg.feesUsd) || leg.feesUsd < 0) {
      return err({
        kind: "invalid_fill",
        message: `fees must be non-negative for ${leg.contractSymbol}`,
      });
    }

    const sign = leg.side === "buy" ? 1 : -1;
    feesUsd += leg.feesUsd;
    slippageUsd += legSlippage(
      leg.side,
      leg.fillPrice,
      leg.referenceMid,
      leg.quantity,
      leg.multiplier
    );
    netPricePerShare += sign * leg.fillPrice * leg.quantity;
    midPricePerShare += sign * leg.referenceMid * leg.quantity;
    notionalMid += leg.referenceMid * leg.quantity * leg.multiplier;
  }

  const slippagePctOfMid = notionalMid > 0 ? (Math.abs(slippageUsd) / notionalMid) * 100 : 0;

  return ok({
    legs,
    feesUsd: roundMoney(feesUsd),
    slippageUsd: roundMoney(slippageUsd),
    netPricePerShare: roundPrice(netPricePerShare),
    midPricePerShare: roundPrice(midPricePerShare),
    slippagePctOfMid: roundPrice(slippagePctOfMid),
    filledAt: legs[0].at,
  });
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function roundPrice(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}
