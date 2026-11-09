import type { OpportunityState } from "../scanner/types.js";
import type { ExecutionConfig } from "./config.js";
import type { ExecutionTrade } from "./types.js";

export type ExitReason =
  | { kind: "invalidation"; state: "invalidated" | "missed" | "expired" }
  | { kind: "profit_target"; fraction: number; pnlUsd: number }
  | { kind: "stop_loss"; fraction: number; pnlUsd: number }
  | { kind: "deadline"; deadline: string }
  | { kind: "time_stop"; heldMs: number }
  | { kind: "manual"; actor: "user" | "scheduler" | "kill_switch" };

export type ExitEvaluation = {
  reason: ExitReason | null;
  /** Why package-based rules could not be evaluated this tick. */
  unable: string | null;
};

export type ExitEvaluationInput = {
  trade: ExecutionTrade;
  setupState: OpportunityState | null;
  /** Signed net price to close the package now; null when quotes are missing. */
  closeNetPerShare: number | null;
  now: Date;
  config: ExecutionConfig;
};

/**
 * Ordered automation rules: invalidation -> profit target -> stop -> deadline
 * -> time stop. Package rules are skipped (not invented) when no fresh close
 * quote exists; deadline and time rules still apply.
 */
export function evaluateExit(input: ExitEvaluationInput): ExitEvaluation {
  const { trade, setupState, closeNetPerShare, now, config } = input;

  if (setupState === "invalidated" || setupState === "missed" || setupState === "expired") {
    return { reason: { kind: "invalidation", state: setupState }, unable: null };
  }

  const entry = trade.entrySummary;
  let unable: string | null = null;
  if (entry && entry.legs.length > 0 && entry.netPricePerShare !== 0) {
    if (closeNetPerShare === null || !Number.isFinite(closeNetPerShare)) {
      unable = "No current package quote for exit evaluation";
    } else {
      const multiplier = entry.legs[0]?.multiplier ?? 100;
      const entryNet = entry.netPricePerShare;
      const pnlPerShare = -(entryNet + closeNetPerShare);
      const pnlUsd = pnlPerShare * multiplier;

      if (entryNet > 0) {
        // Long debit package: profit when closing value exceeds entry by the
        // configured fraction; stop when the loss multiple is reached.
        if (pnlPerShare >= entryNet * config.exits.profitTargetFraction) {
          return {
            reason: {
              kind: "profit_target",
              fraction: config.exits.profitTargetFraction,
              pnlUsd,
            },
            unable: null,
          };
        }
        if (pnlPerShare <= -entryNet * config.exits.stopLossFraction) {
          return {
            reason: {
              kind: "stop_loss",
              fraction: config.exits.stopLossFraction,
              pnlUsd,
            },
            unable: null,
          };
        }
      } else {
        // Short credit package: closeNet is the debit paid to close. Take
        // profit when that debit falls to the target fraction of the credit;
        // stop when it rises past the credit by the stop multiple.
        const credit = -entryNet;
        if (closeNetPerShare <= credit * (1 - config.exits.profitTargetFraction)) {
          return {
            reason: {
              kind: "profit_target",
              fraction: config.exits.profitTargetFraction,
              pnlUsd: (credit - closeNetPerShare) * multiplier,
            },
            unable: null,
          };
        }
        if (closeNetPerShare >= credit * (1 + config.exits.stopLossFraction)) {
          return {
            reason: {
              kind: "stop_loss",
              fraction: config.exits.stopLossFraction,
              pnlUsd: (credit - closeNetPerShare) * multiplier,
            },
            unable: null,
          };
        }
      }
    }
  }

  const deadline = Date.parse(trade.setup.conditions.deadline);
  if (Number.isFinite(deadline) && now.getTime() >= deadline) {
    return {
      reason: { kind: "deadline", deadline: trade.setup.conditions.deadline },
      unable,
    };
  }

  if (config.exits.timeStopMinutes !== null && trade.openedAt) {
    const openedAt = Date.parse(trade.openedAt);
    if (Number.isFinite(openedAt)) {
      const heldMs = now.getTime() - openedAt;
      if (heldMs >= config.exits.timeStopMinutes * 60_000) {
        return { reason: { kind: "time_stop", heldMs }, unable };
      }
    }
  }

  return { reason: null, unable };
}
