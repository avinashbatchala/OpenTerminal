import { describe, expect, it, vi } from "vitest";
import { assessCandidate, scannerCandidateHash, type ScannerAiClient } from "./ai.js";
import { defaultScannerConfig } from "./config.js";
import type { OpportunityCandidate } from "./types.js";

function candidate(): OpportunityCandidate {
  return {
    identityKey: "identity-a",
    muteKey: "mute-a",
    symbol: "AAPL",
    horizon: "swing",
    strategy: "long_call",
    direction: "bullish",
    recipeId: "TREND-PULLBACK",
    recipeVersion: "1.0.0",
    expiry: "2026-11-20",
    deadline: "2026-11-20T14:30:00.000Z",
    legs: [],
    risk: {
      maxLossUsd: 201.75,
      feesUsd: 1.75,
      entryFeesUsd: 0.8,
      exitFeesUsd: 0.8,
      expiryFeesUsd: 0.15,
      netDebitUsd: 200,
      netCreditUsd: null,
      widthUsd: null,
      multiplier: 100,
      contracts: 1,
      slippageScenario: {
        label: "scenario",
        netDebitUsd: 210,
        netCreditUsd: null,
        modeledLossUsd: 211.75,
        includedInRiskLimit: false,
      },
      assumptions: [],
    },
    signal: {
      recipeId: "TREND-PULLBACK",
      recipeVersion: "1.0.0",
      horizon: "swing",
      direction: "bullish",
      signalBarTime: "2026-11-02T14:30:00.000Z",
      features: {},
      barsUsed: 80,
      source: "test",
    },
    thesis: "thesis",
    conditions: {
      entry: "entry",
      invalidation: "invalidation",
      target: "target",
      deadline: "2026-11-20T14:30:00.000Z",
      levels: {
        entry: 101,
        invalidation: 95,
        target: 105,
        chasePct: 0.35,
        rangeLow: null,
        rangeHigh: null,
        shortPut: null,
        shortCall: null,
        minCreditPerShare: null,
        frozenCreditPerShare: null,
        targetCreditFraction: null,
      },
    },
    earnings: { checked: true, nextEarningsDate: null },
    dataHealth: "current",
  };
}

function client(response: unknown): ScannerAiClient {
  return { messages: { create: vi.fn().mockResolvedValue(response) } };
}

const valid = {
  stop_reason: "end_turn",
  content: [
    {
      type: "text",
      text: JSON.stringify({
        summary: "Defined-risk bullish setup.",
        thesis: "Trend continuation with a bounded debit.",
        risks: ["The underlying can invalidate the setup."],
        rank: 77,
        confidence: "medium",
      }),
    },
  ],
  usage: {
    input_tokens: 1000,
    output_tokens: 500,
    cache_read_input_tokens: 200,
    cache_creation_input_tokens: 100,
  },
};

describe("scanner AI assessment", () => {
  it("validates structured output and records actual usage with a configured price source", async () => {
    const config = defaultScannerConfig();
    config.aiPricing = {
      source: "test price sheet v1",
      inputPerMillionUsd: 1,
      outputPerMillionUsd: 2,
      cacheReadPerMillionUsd: 3,
      cacheWritePerMillionUsd: 4,
    };
    const result = await assessCandidate(candidate(), { client: client(valid), config });
    expect(result.status).toBe("ready");
    expect(result.output?.rank).toBe(77);
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(500);
    expect(result.estimatedCostUsd).toBeCloseTo(0.003);
    expect(result.pricingSource).toBe("test price sheet v1");
  });

  it("records malformed output and refusal without trusting it", async () => {
    const config = defaultScannerConfig();
    const malformed = await assessCandidate(candidate(), {
      client: client({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }),
      config,
    });
    expect(malformed.status).toBe("failed");
    expect(malformed.output).toBeNull();
    expect(malformed.error).toContain("Malformed");

    const refused = await assessCandidate(candidate(), {
      client: client({ stop_reason: "refusal", content: [] }),
      config,
    });
    expect(refused.status).toBe("failed");
    expect(refused.error).toContain("declined");
  });

  it("leaves estimated cost unknown when no pricing source is configured", async () => {
    const config = defaultScannerConfig();
    const result = await assessCandidate(candidate(), { client: client(valid), config });
    expect(result.status).toBe("ready");
    expect(result.estimatedCostUsd).toBeNull();
    expect(result.pricingSource).toBeNull();
  });

  it("quantizes only meaningful material changes into the assessment hash", () => {
    const first = candidate();
    const second = candidate();
    second.risk.maxLossUsd = 201.76;
    expect(scannerCandidateHash(first)).toBe(scannerCandidateHash(second));
    second.risk.maxLossUsd = 210;
    expect(scannerCandidateHash(first)).not.toBe(scannerCandidateHash(second));
  });
});
