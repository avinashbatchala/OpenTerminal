export type ExecutionConfig = {
  /** Automation is off until a later phase; manual paper trades still work. */
  enabled: boolean;
  startingCashUsd: number;
  automation: {
    entries: boolean;
    exits: boolean;
  };
  exits: {
    /** Fraction of entry premium (debit) or credit captured before taking profit. */
    profitTargetFraction: number;
    /** Loss multiple of entry premium/credit before stopping out. */
    stopLossFraction: number;
    timeStopMinutes: number | null;
  };
  slippage: {
    spreadFactor: number;
    impactBps: number;
    jitterBps: number;
    maxSlippagePct: number;
  };
  quotes: {
    maxQuoteAgeMs: number;
    /** Extra room above the modeled package price before a limit is rejected. */
    limitBufferPct: number;
  };
  fees: {
    perOrderUsd: number;
    perContractUsd: number;
  };
  limits: {
    maxOpenTrades: number;
    maxPerSymbol: number;
  };
};

export function defaultExecutionConfig(): ExecutionConfig {
  return {
    enabled: false,
    startingCashUsd: 100_000,
    automation: {
      entries: false,
      exits: true,
    },
    exits: {
      profitTargetFraction: 0.5,
      stopLossFraction: 1,
      timeStopMinutes: null,
    },
    slippage: {
      spreadFactor: 1,
      impactBps: 0,
      jitterBps: 0,
      maxSlippagePct: 50,
    },
    quotes: {
      maxQuoteAgeMs: 180_000,
      limitBufferPct: 0.5,
    },
    fees: {
      perOrderUsd: 0.65,
      perContractUsd: 0.15,
    },
    limits: {
      maxOpenTrades: 5,
      maxPerSymbol: 1,
    },
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeExecutionConfig(
  raw: unknown,
  fallback = defaultExecutionConfig()
): ExecutionConfig {
  const value = object(raw);
  const automation = object(value.automation);
  const exits = object(value.exits);
  const slippage = object(value.slippage);
  const quotes = object(value.quotes);
  const fees = object(value.fees);
  const limits = object(value.limits);

  return {
    enabled: bool(value.enabled, fallback.enabled),
    startingCashUsd: Math.max(
      1,
      finite(value.startingCashUsd, fallback.startingCashUsd)
    ),
    automation: {
      entries: bool(automation.entries, fallback.automation.entries),
      exits: bool(automation.exits, fallback.automation.exits),
    },
    exits: {
      profitTargetFraction: Math.min(
        2,
        Math.max(
          0.05,
          finite(exits.profitTargetFraction, fallback.exits.profitTargetFraction)
        )
      ),
      stopLossFraction: Math.min(
        5,
        Math.max(0.1, finite(exits.stopLossFraction, fallback.exits.stopLossFraction))
      ),
      timeStopMinutes:
        exits.timeStopMinutes === null
          ? null
          : Math.max(
              1,
              Math.floor(finite(exits.timeStopMinutes, fallback.exits.timeStopMinutes ?? 0)) || 1
            ),
    },
    slippage: {
      spreadFactor: Math.min(
        2,
        Math.max(0, finite(slippage.spreadFactor, fallback.slippage.spreadFactor))
      ),
      impactBps: Math.max(0, finite(slippage.impactBps, fallback.slippage.impactBps)),
      jitterBps: Math.max(0, finite(slippage.jitterBps, fallback.slippage.jitterBps)),
      maxSlippagePct: Math.max(
        0.01,
        finite(slippage.maxSlippagePct, fallback.slippage.maxSlippagePct)
      ),
    },
    quotes: {
      maxQuoteAgeMs: Math.max(
        1_000,
        finite(quotes.maxQuoteAgeMs, fallback.quotes.maxQuoteAgeMs)
      ),
      limitBufferPct: Math.max(
        0,
        finite(quotes.limitBufferPct, fallback.quotes.limitBufferPct)
      ),
    },
    fees: {
      perOrderUsd: Math.max(0, finite(fees.perOrderUsd, fallback.fees.perOrderUsd)),
      perContractUsd: Math.max(
        0,
        finite(fees.perContractUsd, fallback.fees.perContractUsd)
      ),
    },
    limits: {
      maxOpenTrades: Math.max(
        1,
        Math.floor(finite(limits.maxOpenTrades, fallback.limits.maxOpenTrades))
      ),
      maxPerSymbol: Math.max(
        1,
        Math.floor(finite(limits.maxPerSymbol, fallback.limits.maxPerSymbol))
      ),
    },
  };
}
