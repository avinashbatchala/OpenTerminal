import { describe, expect, it } from "vitest";
import { defaultExecutionConfig, normalizeExecutionConfig } from "./config.js";

describe("execution config", () => {
  it("defaults to paper balances with automation entries off", () => {
    const config = defaultExecutionConfig();
    expect(config.enabled).toBe(false);
    expect(config.startingCashUsd).toBe(100_000);
    expect(config.automation).toEqual({ entries: false, exits: true });
    expect(config.exits.profitTargetFraction).toBe(0.5);
    expect(config.exits.stopLossFraction).toBe(1);
    expect(config.exits.timeStopMinutes).toBeNull();
    expect(config.slippage.spreadFactor).toBe(1);
    expect(config.fees).toEqual({ perOrderUsd: 0.65, perContractUsd: 0.15 });
  });

  it("normalizes automation and exit overrides", () => {
    const config = normalizeExecutionConfig({
      enabled: true,
      automation: { entries: true },
      exits: { profitTargetFraction: 0.25, stopLossFraction: 2, timeStopMinutes: 90 },
      limits: { maxOpenTrades: 3, maxPerSymbol: 2 },
      slippage: { spreadFactor: 0.5, maxSlippagePct: 5 },
    });

    expect(config.enabled).toBe(true);
    expect(config.automation).toEqual({ entries: true, exits: true });
    expect(config.exits).toEqual({
      profitTargetFraction: 0.25,
      stopLossFraction: 2,
      timeStopMinutes: 90,
    });
    expect(config.limits).toEqual({ maxOpenTrades: 3, maxPerSymbol: 2 });
    expect(config.slippage.spreadFactor).toBe(0.5);
  });

  it("clamps invalid values instead of persisting them", () => {
    const config = normalizeExecutionConfig({
      startingCashUsd: 0,
      automation: { entries: "yes" },
      exits: { profitTargetFraction: 99, stopLossFraction: 0, timeStopMinutes: -5 },
      slippage: { spreadFactor: 10, impactBps: -1 },
      limits: { maxOpenTrades: 0 },
    });

    expect(config.startingCashUsd).toBe(1);
    expect(config.automation.entries).toBe(false);
    expect(config.exits.profitTargetFraction).toBe(2);
    expect(config.exits.stopLossFraction).toBe(0.1);
    expect(config.exits.timeStopMinutes).toBe(1);
    expect(config.slippage.spreadFactor).toBe(2);
    expect(config.slippage.impactBps).toBe(0);
    expect(config.limits.maxOpenTrades).toBe(1);
  });
});
