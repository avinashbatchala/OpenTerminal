import { describe, expect, it } from "vitest";
import { calculateRisk, buildCandidates, selectExpiryForHorizon } from "./contracts.js";
import { defaultScannerConfig } from "./config.js";
import type { NormalizedChain, NormalizedOption, NormalizedQuote } from "./market.js";
import type { SignalResult } from "./signals.js";
import type { ScannerConfig, ScannerLeg } from "./types.js";

const now = new Date("2026-11-02T15:00:00Z");

function config(): ScannerConfig {
  return defaultScannerConfig();
}

function leg(overrides: Partial<ScannerLeg> = {}): ScannerLeg {
  return {
    contractSymbol: "AAPL261120C00100000",
    underlying: "AAPL",
    expiry: "2026-11-20",
    optionType: "call",
    strike: 100,
    side: "buy",
    quantity: 1,
    ratio: 1,
    multiplier: 100,
    bid: 1.9,
    ask: 2,
    quoteTime: now.toISOString(),
    source: "test",
    deliverable: "100 shares",
    deliverableSource: "provider",
    ...overrides,
  };
}

function option(overrides: Partial<NormalizedOption> = {}): NormalizedOption {
  const strike = overrides.strike ?? 100;
  const optionType = overrides.optionType ?? "call";
  return {
    contractSymbol: `AAPL261120${optionType === "call" ? "C" : "P"}${String(strike * 1000).padStart(8, "0")}`,
    underlying: "AAPL",
    expiry: "2026-11-20",
    optionType,
    strike,
    bid: 0.8,
    ask: 1,
    volume: 1000,
    openInterest: 1000,
    impliedVolatility: 0.3,
    quoteTime: now.toISOString(),
    source: "test",
    multiplier: 100,
    deliverable: "100 shares",
    deliverableSource: "provider",
    ...overrides,
  };
}

function chain(calls: NormalizedOption[], puts: NormalizedOption[] = []): NormalizedChain {
  return {
    symbol: "AAPL",
    requestedExpiry: "2026-11-20",
    selectedDate: "2026-11-20",
    underlyingPrice: 100,
    expirationDates: ["2026-11-20"],
    calls,
    puts,
    retrievedAt: now.toISOString(),
    source: "test",
    issues: [],
  };
}

const quote: NormalizedQuote = {
  symbol: "AAPL",
  price: 100,
  bid: 99.99,
  ask: 100.01,
  quoteTime: now.toISOString(),
  source: "test",
  retrievedAt: now.toISOString(),
  marketState: "REGULAR",
};

const signal: SignalResult = {
  recipeId: "TREND-PULLBACK",
  horizon: "swing",
  direction: "bullish",
  signalBarTime: "2026-11-02T14:30:00Z",
  signalBar: { time: 1, open: 99, high: 100, low: 98, close: 99.5, volume: 1000 },
  barsUsed: 80,
  entry: 101,
  invalidation: 95,
  target: 105,
  range: null,
  features: { emaFast: 99, emaSlow: 98 },
};

describe("risk and contract selection", () => {
  it("includes all configured fee components in the modeled long-option loss", () => {
    const result = calculateRisk("long_call", [leg()], config());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.risk.maxLossUsd).toBe(201.75);
    expect(result.risk.entryFeesUsd).toBe(0.8);
    expect(result.risk.exitFeesUsd).toBe(0.8);
    expect(result.risk.expiryFeesUsd).toBe(0.15);
    expect(result.risk.slippageScenario.includedInRiskLimit).toBe(false);
  });

  it("rejects a long option that crosses the $250 modeled-loss boundary", () => {
    const result = calculateRisk("long_call", [leg({ ask: 2.5 })], config());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("exceeds");
  });

  it("calculates debit, credit, and iron-condor losses with defined widths", () => {
    const debit = calculateRisk(
      "debit_call_spread",
      [leg({ ask: 2 }), leg({ side: "sell", strike: 105, bid: 0.8, ask: 1 })],
      config()
    );
    expect(debit.ok && debit.risk.maxLossUsd).toBe(122.2);

    const rejectedCredit = calculateRisk(
      "bull_put_credit",
      [
        leg({ optionType: "put", side: "sell", strike: 95, bid: 2, ask: 2.2 }),
        leg({ optionType: "put", side: "buy", strike: 90, bid: 0.5, ask: 0.7 }),
      ],
      config()
    );
    expect(rejectedCredit.ok).toBe(false);

    const tightCredit = calculateRisk(
      "bull_put_credit",
      [
        leg({ optionType: "put", side: "sell", strike: 95, bid: 2, ask: 2.2 }),
        leg({ optionType: "put", side: "buy", strike: 92, bid: 0.5, ask: 0.7 }),
      ],
      config()
    );
    expect(tightCredit.ok && tightCredit.risk.maxLossUsd).toBe(172.2);

    const condor = calculateRisk(
      "iron_condor",
      [
        leg({ optionType: "put", side: "sell", strike: 95, bid: 2, ask: 2.2 }),
        leg({ optionType: "put", side: "buy", strike: 90, bid: 0.3, ask: 0.5 }),
        leg({ side: "sell", strike: 105, bid: 2, ask: 2.2 }),
        leg({ side: "buy", strike: 110, bid: 0.3, ask: 0.5 }),
      ],
      config()
    );
    expect(condor.ok && condor.risk.maxLossUsd).toBe(203.1);
  });

  it("rejects missing, crossed, stale, and unsupported contracts", () => {
    const baseCalls = [
      option({ strike: 100, bid: 0.9, ask: 1 }),
      option({ strike: 102, bid: 1, ask: 1.1 }),
    ];
    const missing = buildCandidates(
      signal,
      "AAPL",
      quote,
      chain([option({ strike: 100, multiplier: null, deliverable: null, deliverableSource: null })]),
      "2026-11-20",
      config(),
      now,
      "2026-11-20T14:30:00Z",
      { checked: true, nextEarningsDate: null }
    );
    expect(missing.candidates).toHaveLength(0);
    expect(missing.issues.join(" ")).toContain("multiplier");

    const crossed = buildCandidates(
      signal,
      "AAPL",
      quote,
      chain([option({ strike: 100, bid: 1.2, ask: 1 }), option({ strike: 102 })]),
      "2026-11-20",
      config(),
      now,
      "2026-11-20T14:30:00Z",
      { checked: true, nextEarningsDate: null }
    );
    expect(crossed.candidates).toHaveLength(0);

    const stale = buildCandidates(
      signal,
      "AAPL",
      quote,
      chain([option({ strike: 100, quoteTime: "2026-11-02T14:00:00Z" })]),
      "2026-11-20",
      config(),
      now,
      "2026-11-20T14:30:00Z",
      { checked: true, nextEarningsDate: null }
    );
    expect(stale.candidates).toHaveLength(0);

    const stable = buildCandidates(
      signal,
      "AAPL",
      quote,
      chain(baseCalls),
      "2026-11-20",
      config(),
      now,
      "2026-11-20T14:30:00Z",
      { checked: true, nextEarningsDate: null }
    );
    expect(stable.candidates.length).toBeGreaterThan(0);
    expect(stable.candidates[0].legs[0].contractSymbol).toContain("C00100000");
  });

  it("builds an ordered iron condor and a directional credit spread without inventing strikes", () => {
    const configured = config();
    configured.selection.creditWingWidthPct = 4;
    const condorChain = chain(
      [
        option({ strike: 100, bid: 5, ask: 5.2 }),
        option({ strike: 106, bid: 2, ask: 2.2 }),
        option({ strike: 109, bid: 1, ask: 1.1 }),
      ],
      [
        option({ strike: 100, optionType: "put", bid: 5, ask: 5.2 }),
        option({ strike: 94, optionType: "put", bid: 2, ask: 2.2 }),
        option({ strike: 90, optionType: "put", bid: 1, ask: 1.1 }),
      ]
    );
    const condorSignal: SignalResult = {
      ...signal,
      recipeId: "VOLATILITY-RANGE",
      direction: "neutral",
      entry: null,
      invalidation: null,
      target: null,
      range: { low: 95, high: 105 },
      signalBar: { ...signal.signalBar, close: 100 },
    };
    const condor = buildCandidates(
      condorSignal,
      "AAPL",
      quote,
      condorChain,
      "2026-11-20",
      configured,
      now,
      "2026-11-20T14:30:00Z",
      { checked: true, nextEarningsDate: null }
    );
    expect(condor.candidates).toHaveLength(1);
    const legs = condor.candidates[0].legs;
    expect(legs.map((entry) => [entry.optionType, entry.side, entry.strike])).toEqual([
      ["put", "sell", 94],
      ["put", "buy", 90],
      ["call", "sell", 106],
      ["call", "buy", 109],
    ]);
    expect(condor.candidates[0].strategy).toBe("iron_condor");
    expect(condor.candidates[0].risk.maxLossUsd).toBeLessThanOrEqual(250);

    const creditSignal: SignalResult = {
      ...signal,
      recipeId: "VOLATILITY-TREND-CREDIT",
      direction: "bearish",
      entry: 99,
      invalidation: 105,
      target: 90,
      signalBar: { ...signal.signalBar, close: 100 },
    };
    const credit = buildCandidates(
      creditSignal,
      "AAPL",
      quote,
      condorChain,
      "2026-11-20",
      configured,
      now,
      "2026-11-20T14:30:00Z",
      { checked: true, nextEarningsDate: null }
    );
    expect(credit.candidates).toHaveLength(1);
    expect(credit.candidates[0].strategy).toBe("bear_call_credit");
    expect(credit.candidates[0].legs.map((entry) => [entry.side, entry.strike])).toEqual([
      ["sell", 106],
      ["buy", 109],
    ]);
  });

  it("selects only expiries within the configured horizon and resolves deterministically", () => {
    const selection = selectExpiryForHorizon(
      ["2026-11-13", "2026-11-20", "2026-12-18", "2027-06-18"],
      "swing",
      config(),
      now
    );
    expect(selection.issues).toHaveLength(0);
    expect(selection.expiry).toBe("2026-11-20");
    expect(selectExpiryForHorizon(["2027-06-18"], "intraday", config(), now).expiry).toBeNull();
  });
});
