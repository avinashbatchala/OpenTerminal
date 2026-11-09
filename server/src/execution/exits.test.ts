import { describe, expect, it } from "vitest";
import { defaultExecutionConfig, type ExecutionConfig } from "./config.js";
import { evaluateExit } from "./exits.js";
import type { ExecutionTrade } from "./types.js";

const NOW = new Date("2026-11-09T15:00:00.000Z");

function trade(overrides: Partial<ExecutionTrade> = {}): ExecutionTrade {
  return {
    id: "trade-1",
    opportunityId: "opp-1",
    identityKey: "identity-1",
    symbol: "AAPL",
    horizon: "swing",
    strategy: "long_call",
    status: "open",
    setup: {
      conditions: { deadline: "2026-11-20T14:30:00.000Z" },
    } as ExecutionTrade["setup"],
    entryOrderId: "trade-1:entry",
    exitOrderId: null,
    entrySummary: {
      legs: [
        {
          contractSymbol: "AAPL261120C00100000",
          side: "buy",
          quantity: 1,
          multiplier: 100,
          referenceMid: 1.2,
          fillPrice: 1.2,
          feesUsd: 0.8,
          slippageUsd: 0,
          at: NOW.toISOString(),
        },
      ],
      feesUsd: 0.8,
      slippageUsd: 0,
      netPricePerShare: 1.2,
      midPricePerShare: 1.2,
      slippagePctOfMid: 0,
      filledAt: NOW.toISOString(),
    },
    exitSummary: null,
    pnl: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    openedAt: NOW.toISOString(),
    closedAt: null,
    ...overrides,
  };
}

function config(overrides: Partial<ExecutionConfig["exits"]> = {}): ExecutionConfig {
  return {
    ...defaultExecutionConfig(),
    exits: {
      ...defaultExecutionConfig().exits,
      ...overrides,
    },
  };
}

describe("exit rules", () => {
  it("prioritises invalidation", () => {
    const result = evaluateExit({
      trade: trade(),
      setupState: "invalidated",
      closeNetPerShare: -2,
      now: NOW,
      config: config(),
    });
    expect(result.reason?.kind).toBe("invalidation");
  });

  it("takes profit on a debit package", () => {
    // Entry 1.20; closing at 1.90 is +0.70 per share (58% of premium).
    const result = evaluateExit({
      trade: trade(),
      setupState: "entry_ready",
      closeNetPerShare: -1.9,
      now: NOW,
      config: config({ profitTargetFraction: 0.5 }),
    });
    expect(result.reason?.kind).toBe("profit_target");
  });

  it("stops a debit package at the configured multiple", () => {
    // Entry 1.20; closing at 0.10 is -1.10, beyond -1.20? Use 0.00 for -1.20.
    const result = evaluateExit({
      trade: trade(),
      setupState: "watching",
      closeNetPerShare: 0,
      now: NOW,
      config: config({ stopLossFraction: 1 }),
    });
    expect(result.reason?.kind).toBe("stop_loss");
  });

  it("takes profit on a credit package", () => {
    const credit = trade({
      entrySummary: {
        ...trade().entrySummary!,
        netPricePerShare: -0.9,
        legs: [{ ...trade().entrySummary!.legs[0], side: "sell" }],
      },
    });
    const result = evaluateExit({
      trade: credit,
      setupState: "watching",
      closeNetPerShare: 0.4,
      now: NOW,
      config: config({ profitTargetFraction: 0.5 }),
    });
    expect(result.reason?.kind).toBe("profit_target");
  });

  it("stops a credit package when the close debit exceeds the credit", () => {
    const credit = trade({
      entrySummary: {
        ...trade().entrySummary!,
        netPricePerShare: -0.9,
        legs: [{ ...trade().entrySummary!.legs[0], side: "sell" }],
      },
    });
    const result = evaluateExit({
      trade: credit,
      setupState: "watching",
      closeNetPerShare: 1.8,
      now: NOW,
      config: config({ stopLossFraction: 1 }),
    });
    expect(result.reason?.kind).toBe("stop_loss");
  });

  it("closes at the deadline and time stop", () => {
    const deadline = evaluateExit({
      trade: trade(),
      setupState: "watching",
      closeNetPerShare: -1.2,
      now: new Date("2026-11-20T14:30:00.000Z"),
      config: config(),
    });
    expect(deadline.reason?.kind).toBe("deadline");

    const timed = evaluateExit({
      trade: trade(),
      setupState: "watching",
      closeNetPerShare: -1.2,
      now: new Date(NOW.getTime() + 61 * 60_000),
      config: config({ timeStopMinutes: 60 }),
    });
    expect(timed.reason?.kind).toBe("time_stop");
  });

  it("does not invent package rules without a quote", () => {
    const result = evaluateExit({
      trade: trade(),
      setupState: "watching",
      closeNetPerShare: null,
      now: NOW,
      config: config(),
    });
    expect(result.reason).toBeNull();
    expect(result.unable).toContain("No current package quote");
  });
});
