import { describe, expect, it } from "vitest";
import {
  defaultScannerConfig,
  normalizeScannerConfig,
  scannerReadiness,
} from "./config.js";
import { RECIPE_VERSION } from "./types.js";

function readyConfig() {
  const config = defaultScannerConfig();
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

describe("scanner configuration", () => {
  it("blocks activation until every required assumption is explicitly reviewed", () => {
    const readiness = scannerReadiness(defaultScannerConfig());
    expect(readiness.ready).toBe(false);
    expect(readiness.issues).toEqual(
      expect.arrayContaining([
        "Fee assumptions must be reviewed and confirmed",
        "Intraday expiry range must be reviewed and confirmed",
        "Swing expiry range must be reviewed and confirmed",
        "Quote age, skew, width, and liquidity limits must be confirmed",
        "Contract selection and strike-enumeration policy must be confirmed",
        "Provider history and adjusted-data assumptions must be reviewed",
        "Enable at least one reviewed recipe",
      ])
    );
  });

  it("requires recipe version, parameter approval, and valid bounds", () => {
    const config = readyConfig();
    config.recipes["TREND-PULLBACK"].acceptedVersion = null;
    config.recipes["TREND-PULLBACK"].paramsApproved = false;
    config.recipes["TREND-PULLBACK"].params.emaFast = 500;
    const readiness = scannerReadiness(config);
    expect(readiness.ready).toBe(false);
    expect(readiness.issues.join(" ")).toContain("Review and accept recipe version");
    expect(readiness.issues.join(" ")).toContain("parameters must be explicitly approved");
    expect(readiness.issues.join(" ")).toContain("Fast EMA must be between");
  });

  it("does not treat IV warming as permission to enable another recipe or as a global blocker", () => {
    const config = readyConfig();
    const readiness = scannerReadiness(config, {
      "VOLATILITY-RANGE": { ready: false, issues: ["warming up: 2/20 days"] },
    });
    expect(readiness.ready).toBe(true);
    expect(readiness.warnings.join(" ")).toContain("warming up");
  });

  it("keeps incoming confirmation flags false unless explicitly set", () => {
    const normalized = normalizeScannerConfig(
      {
        fees: { perOrderUsd: 1 },
        horizons: { swing: { minDays: 10, maxDays: 20 } },
        recipes: { "TREND-PULLBACK": { enabled: true } },
      },
      defaultScannerConfig()
    );
    expect(normalized.fees.confirmed).toBe(false);
    expect(normalized.horizons.swing.confirmed).toBe(false);
    expect(normalized.recipes["TREND-PULLBACK"].enabled).toBe(true);
    expect(normalized.recipes["TREND-PULLBACK"].acceptedVersion).toBeNull();
    expect(normalized.recipes["TREND-PULLBACK"].paramsApproved).toBe(false);
  });
});
