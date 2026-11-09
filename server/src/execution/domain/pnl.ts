import type { Result } from "../ports/broker.js";
import { err, ok } from "../ports/broker.js";
import { roundMoney, type FillSummary } from "./fill.js";

export type TradePnl = {
  grossUsd: number;
  feesUsd: number;
  netUsd: number;
  entryNetPerShare: number;
  exitNetPerShare: number;
  multiplier: number;
};

export type PnlError = { kind: "invalid_pnl"; message: string };

/**
 * Realized P&L for a closed package. The fill summary is signed (positive
 * debit, negative credit), so entry and exit cash flows net out:
 * `-(entry + exit) * multiplier - fees`.
 */
export function computeTradePnl(
  entry: FillSummary,
  exit: FillSummary
): Result<TradePnl, PnlError> {
  if (entry.legs.length === 0 || exit.legs.length === 0) {
    return err({ kind: "invalid_pnl", message: "entry and exit fills are required" });
  }

  const entryMultipliers = new Set(entry.legs.map((leg) => leg.multiplier));
  const exitMultipliers = new Set(exit.legs.map((leg) => leg.multiplier));
  if (entryMultipliers.size !== 1 || exitMultipliers.size !== 1) {
    return err({ kind: "invalid_pnl", message: "legs do not share one multiplier" });
  }

  const entryMultiplier = entry.legs[0].multiplier;
  const exitMultiplier = exit.legs[0].multiplier;
  if (entryMultiplier !== exitMultiplier) {
    return err({ kind: "invalid_pnl", message: "entry and exit multipliers differ" });
  }

  const grossUsd = -(entry.netPricePerShare + exit.netPricePerShare) * entryMultiplier;
  const feesUsd = entry.feesUsd + exit.feesUsd;

  return ok({
    grossUsd: roundMoney(grossUsd),
    feesUsd: roundMoney(feesUsd),
    netUsd: roundMoney(grossUsd - feesUsd),
    entryNetPerShare: entry.netPricePerShare,
    exitNetPerShare: exit.netPricePerShare,
    multiplier: entryMultiplier,
  });
}
