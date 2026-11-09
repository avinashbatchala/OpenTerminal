import { describe, expect, it, vi } from "vitest";
import { defaultScannerConfig } from "./config.js";
import { ScannerScheduler } from "./scheduler.js";
import type { ScanRun, ScannerConfig } from "./types.js";
import { RECIPE_VERSION } from "./types.js";

function readyConfig(): ScannerConfig {
  const config = defaultScannerConfig();
  config.enabled = true;
  config.fees.confirmed = true;
  config.horizons.intraday.confirmed = true;
  config.horizons.swing.confirmed = true;
  config.quotes.confirmed = true;
  config.selection.confirmed = true;
  config.historyAssumptionAccepted = true;
  config.recipes["TREND-PULLBACK"] = {
    ...config.recipes["TREND-PULLBACK"],
    enabled: true,
    acceptedVersion: RECIPE_VERSION,
    paramsApproved: true,
  };
  return config;
}

function engineStub() {
  return {
    expireDeadlines: vi.fn(() => 0),
    runMonitoring: vi.fn(async () => ({ status: "completed" as const, checks: 0 })),
    runScan: vi.fn(async () => ({ status: "completed" as const })),
  };
}

function storeStub(config: ScannerConfig, last: Partial<ScanRun> | null) {
  return {
    getConfig: () => config,
    lastCompletedRun: () => last,
    recordMonitoringGap: vi.fn(),
  };
}

describe("scanner scheduler cadence", () => {
  it("runs the fast quote pass between scans", async () => {
    const now = new Date("2026-11-09T15:00:00Z");
    const last = { id: 7, startedAt: new Date(now.getTime() - 60_000).toISOString() };
    const engine = engineStub();
    const scheduler = new ScannerScheduler(
      engine as never,
      storeStub(readyConfig(), last) as never
    );

    await scheduler.tick(now);

    expect(engine.runMonitoring).toHaveBeenCalledTimes(1);
    expect(engine.runScan).not.toHaveBeenCalled();
  });

  it("runs the full scan once the interval is due", async () => {
    const now = new Date("2026-11-09T15:00:00Z");
    const last = { id: 8, startedAt: new Date(now.getTime() - 6 * 60_000).toISOString() };
    const engine = engineStub();
    const scheduler = new ScannerScheduler(
      engine as never,
      storeStub(readyConfig(), last) as never
    );

    await scheduler.tick(now);

    expect(engine.runScan).toHaveBeenCalledTimes(1);
    expect(engine.runMonitoring).not.toHaveBeenCalled();
  });

  it("stays idle when the scanner is paused", async () => {
    const now = new Date("2026-11-09T15:00:00Z");
    const config = readyConfig();
    config.enabled = false;
    const engine = engineStub();
    const scheduler = new ScannerScheduler(engine as never, storeStub(config, null) as never);

    await scheduler.tick(now);

    expect(engine.expireDeadlines).toHaveBeenCalledTimes(1);
    expect(engine.runMonitoring).not.toHaveBeenCalled();
    expect(engine.runScan).not.toHaveBeenCalled();
  });
});
