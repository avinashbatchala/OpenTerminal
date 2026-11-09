import type { NormalizedChain } from "../scanner/market.js";
import type { ScannerLeg } from "../scanner/types.js";
import type { FillModelQuote } from "./adapters/paper/fillModel.js";
import { roundPrice } from "./domain/fill.js";
import type { Result } from "./ports/broker.js";
import { err, ok } from "./ports/broker.js";

export type PricingError =
  | { kind: "missing_quote"; contractSymbol: string }
  | { kind: "invalid_quote"; contractSymbol: string; message: string };

export function quotesFromChain(chain: NormalizedChain): Map<string, FillModelQuote> {
  const quotes = new Map<string, FillModelQuote>();
  for (const option of [...chain.calls, ...chain.puts]) {
    quotes.set(option.contractSymbol, {
      contractSymbol: option.contractSymbol,
      bid: option.bid,
      ask: option.ask,
      quoteTime: option.quoteTime,
      multiplier: option.multiplier,
    });
  }
  return quotes;
}

/**
 * Marketable package limit: cross each leg at the touch, then leave a small
 * adverse buffer. The signed result is positive for a debit and negative for a
 * credit, matching `FillSummary.netPricePerShare` and the broker limit check.
 */
export function packageLimitPrice(
  legs: readonly ScannerLeg[],
  quotes: ReadonlyMap<string, FillModelQuote>,
  bufferPct: number
): Result<number, PricingError> {
  if (legs.length === 0) {
    return err({ kind: "missing_quote", contractSymbol: "none" });
  }

  let net = 0;
  for (const leg of legs) {
    const quote = quotes.get(leg.contractSymbol);
    if (!quote) return err({ kind: "missing_quote", contractSymbol: leg.contractSymbol });

    const price = leg.side === "buy" ? quote.ask : quote.bid;
    if (price === null || !Number.isFinite(price) || price <= 0) {
      return err({
        kind: "invalid_quote",
        contractSymbol: leg.contractSymbol,
        message: "missing or non-positive touch price",
      });
    }

    const sign = leg.side === "buy" ? 1 : -1;
    net += sign * price * leg.quantity;
  }

  const buffer = Math.max(0, bufferPct) / 100;
  const limit = net + Math.abs(net) * buffer;
  return ok(roundPrice(limit));
}
