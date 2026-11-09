import { apiKey } from "../auth.js";
import { sessionDay } from "./calendar.js";
import type { Bar } from "./indicators.js";
import type { Horizon } from "./types.js";

const INTERNAL_BASE =
  process.env.AI_INTERNAL_API_URL?.trim() ||
  (() => {
    const host = process.env.API_HOST ?? "127.0.0.1";
    const connectHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
    return `http://${connectHost}:${process.env.API_PORT ?? 4000}`;
  })();

const REQUEST_TIMEOUT_MS = 10_000;

export type NormalizedQuote = {
  symbol: string;
  price: number | null;
  bid: number | null;
  ask: number | null;
  quoteTime: string | null;
  source: string;
  retrievedAt: string;
  marketState: string | null;
};

export type NormalizedHistory = {
  symbol: string;
  horizon: Horizon;
  bars: Bar[];
  intervalSeconds: number;
  adjusted: false;
  source: string;
  retrievedAt: string;
  issues: string[];
};

export type NormalizedOption = {
  contractSymbol: string;
  underlying: string;
  expiry: string;
  optionType: "call" | "put";
  strike: number;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  quoteTime: string | null;
  source: string;
  multiplier: number | null;
  deliverable: string | null;
  deliverableSource: "provider" | "derived" | null;
};

export type NormalizedChain = {
  symbol: string;
  requestedExpiry: string;
  selectedDate: string | null;
  underlyingPrice: number | null;
  expirationDates: string[];
  calls: NormalizedOption[];
  puts: NormalizedOption[];
  retrievedAt: string;
  source: string;
  issues: string[];
};

export type EarningsMap = Record<string, { nextEarningsDate: string | null }>;

export type ScannerMarketData = {
  quote(symbol: string): Promise<NormalizedQuote>;
  history(symbol: string, horizon: Horizon): Promise<NormalizedHistory>;
  expirations(symbol: string): Promise<string[]>;
  /**
   * `fresh` bypasses the route's short chain cache. Live marks use it so a
   * polling fallback can see quotes newer than the 60-second scanner cache.
   */
  chain(symbol: string, expiry: string, options?: { fresh?: boolean }): Promise<NormalizedChain>;
  earnings(symbols: string[]): Promise<EarningsMap>;
};

async function getJson<T>(path: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${INTERNAL_BASE}/api${path}`, {
        headers: { "x-api-key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
      const text = await res.text();
      if (!res.ok) {
        let message = text.slice(0, 300);
        try {
          const body = JSON.parse(text) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // keep text preview
        }
        throw new Error(message || `HTTP ${res.status}`);
      }
      return JSON.parse(text) as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isoFromSeconds(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  const ms = seconds > 1_000_000_000_000 ? seconds : seconds * 1000;
  return new Date(ms).toISOString();
}

function normalizeQuote(raw: any, symbol: string): NormalizedQuote {
  return {
    symbol: String(raw?.symbol ?? symbol).toUpperCase(),
    price: typeof raw?.price === "number" ? raw.price : null,
    bid: typeof raw?.bid === "number" ? raw.bid : null,
    ask: typeof raw?.ask === "number" ? raw.ask : null,
    quoteTime: isoFromSeconds(typeof raw?.time === "number" ? raw.time : null),
    source: String(raw?.source ?? "market-api"),
    retrievedAt: new Date().toISOString(),
    marketState: typeof raw?.marketState === "string" ? raw.marketState : null,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function normalizeHistory(
  symbol: string,
  horizon: Horizon,
  raw: any,
  now: Date
): NormalizedHistory {
  const rows = Array.isArray(raw) ? raw : [];
  const candles: Bar[] = rows
    .filter(
      (row: any) =>
        typeof row?.time === "number" &&
        Number.isFinite(row.open) &&
        Number.isFinite(row.high) &&
        Number.isFinite(row.low) &&
        Number.isFinite(row.close)
    )
    .map((row: any) => ({
      time: row.time,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: Number.isFinite(row.volume) ? row.volume : 0,
    }))
    .sort((a, b) => a.time - b.time);

  const deduped = candles.filter((bar, index) => index === 0 || bar.time !== candles[index - 1].time);
  const gaps = deduped.slice(1).map((bar, index) => bar.time - deduped[index].time).filter((gap) => gap > 0);
  const intervalSeconds = gaps.length ? median(gaps) : 0;
  const issues: string[] = [];

  let spacingInvalid = false;
  if (deduped.length < 2) issues.push("Insufficient OHLCV history");
  if (horizon === "intraday" && (intervalSeconds < 240 || intervalSeconds > 360)) {
    spacingInvalid = true;
    issues.push(
      `Expected five-minute intraday bars, received a median spacing of ${Math.round(
        intervalSeconds
      )} seconds`
    );
  }
  if (horizon === "swing" && intervalSeconds < 20 * 3600) {
    spacingInvalid = true;
    issues.push(
      `Expected completed daily bars, received a median spacing of ${Math.round(
        intervalSeconds / 3600
      )} hours`
    );
  }

  const nowSeconds = now.getTime() / 1000;
  const closed = spacingInvalid ? [] : deduped.filter((bar) => {
    if (horizon === "intraday") return bar.time + intervalSeconds <= nowSeconds;
    const barDate = new Date(bar.time * 1000).toISOString().slice(0, 10);
    const day = sessionDay(barDate);
    const close = day.close ? Date.parse(day.close) / 1000 : null;
    return close !== null && nowSeconds >= close;
  });

  return {
    symbol,
    horizon,
    bars: closed,
    intervalSeconds,
    adjusted: false,
    source: "market-api",
    retrievedAt: now.toISOString(),
    issues,
  };
}

function derivedDeliverable(multiplier: number | null, contractSymbol: string | null): {
  deliverable: string | null;
  source: "provider" | "derived" | null;
} {
  if (multiplier === 100 && contractSymbol) {
    return { deliverable: "100 shares (derived from standard OCC identifier)", source: "derived" };
  }
  return { deliverable: null, source: null };
}

function normalizeOption(
  raw: any,
  underlying: string,
  expiry: string,
  optionType: "call" | "put"
): NormalizedOption | null {
  const contractSymbol =
    typeof raw?.contractSymbol === "string" && raw.contractSymbol.trim()
      ? raw.contractSymbol.trim()
      : null;
  const strike = typeof raw?.strike === "number" && Number.isFinite(raw.strike) ? raw.strike : null;
  if (!contractSymbol || strike === null || strike <= 0) return null;
  const explicitMultiplier =
    typeof raw?.multiplier === "number" && Number.isFinite(raw.multiplier)
      ? raw.multiplier
      : null;
  // Public fallbacks often omit contract metadata. Treat a standard OCC
  // identifier as the standard 100-share equity/ETF contract, and mark the
  // deliverable as derived so the UI never presents it as provider-verified.
  const multiplier = explicitMultiplier ?? (contractSymbol ? 100 : null);
  const explicitDeliverable =
    typeof raw?.deliverable === "string" && raw.deliverable.trim() ? raw.deliverable.trim() : null;
  const derived = explicitDeliverable ? null : derivedDeliverable(multiplier, contractSymbol);
  return {
    contractSymbol,
    underlying,
    expiry,
    optionType,
    strike,
    bid: typeof raw?.bid === "number" ? raw.bid : null,
    ask: typeof raw?.ask === "number" ? raw.ask : null,
    volume: typeof raw?.volume === "number" ? raw.volume : null,
    openInterest: typeof raw?.openInterest === "number" ? raw.openInterest : null,
    impliedVolatility:
      typeof raw?.impliedVolatility === "number" && raw.impliedVolatility > 0
        ? raw.impliedVolatility
        : null,
    quoteTime: isoFromSeconds(typeof raw?.quoteTime === "number" ? raw.quoteTime : null),
    source: String(raw?.source ?? "market-api"),
    multiplier,
    deliverable: explicitDeliverable ?? derived?.deliverable ?? null,
    deliverableSource: explicitDeliverable ? "provider" : derived?.source ?? null,
  };
}

function normalizeChain(
  symbol: string,
  requestedExpiry: string,
  raw: any,
  now: Date
): NormalizedChain {
  const selectedDate = typeof raw?.selectedDate === "string" ? raw.selectedDate : null;
  const issues: string[] = [];
  if (!selectedDate) issues.push("Option chain did not identify an expiry");
  else if (selectedDate !== requestedExpiry) {
    issues.push(`Provider returned ${selectedDate} instead of requested expiry ${requestedExpiry}`);
  }
  return {
    symbol,
    requestedExpiry,
    selectedDate,
    underlyingPrice:
      typeof raw?.underlyingPrice === "number" ? raw.underlyingPrice : null,
    expirationDates: Array.isArray(raw?.expirationDates) ? raw.expirationDates : [],
    calls: (Array.isArray(raw?.calls) ? raw.calls : [])
      .map((row: any) => normalizeOption(row, symbol, requestedExpiry, "call"))
      .filter((row: NormalizedOption | null): row is NormalizedOption => row !== null),
    puts: (Array.isArray(raw?.puts) ? raw.puts : [])
      .map((row: any) => normalizeOption(row, symbol, requestedExpiry, "put"))
      .filter((row: NormalizedOption | null): row is NormalizedOption => row !== null),
    retrievedAt: now.toISOString(),
    source: "market-api",
    issues,
  };
}

export function createHttpScannerMarketData(): ScannerMarketData {
  return {
    async quote(symbol) {
      const rows = await getJson<any[]>(`/quotes?symbols=${encodeURIComponent(symbol)}`);
      const raw = rows.find((row) => String(row?.symbol).toUpperCase() === symbol);
      if (!raw) throw new Error(`No quote for ${symbol}`);
      return normalizeQuote(raw, symbol);
    },
    async history(symbol, horizon) {
      // Intraday features require five-minute bars. Ask for that spacing
      // explicitly; the market route gates each provider so a one-minute or
      // daily response is rejected rather than relabeled.
      const range = horizon === "intraday" ? "1D&interval=5m" : "1Y";
      const raw = await getJson<any>(`/history/${encodeURIComponent(symbol)}?range=${range}`);
      return normalizeHistory(symbol, horizon, raw, new Date());
    },
    async expirations(symbol) {
      const raw = await getJson<any>(`/options/${encodeURIComponent(symbol)}`);
      return Array.isArray(raw?.expirationDates)
        ? raw.expirationDates.filter((entry: unknown): entry is string => typeof entry === "string")
        : [];
    },
    async chain(symbol, expiry, options) {
      const fresh = options?.fresh ? "&fresh=1" : "";
      const raw = await getJson<any>(
        `/options/${encodeURIComponent(symbol)}?expiry=${encodeURIComponent(expiry)}&requireQuotes=1${fresh}`
      );
      return normalizeChain(symbol, expiry, raw, new Date());
    },
    async earnings(symbols) {
      if (symbols.length === 0) return {};
      const raw = await getJson<any[]>(`/calendar?symbols=${encodeURIComponent(symbols.join(","))}`);
      const result: EarningsMap = {};
      for (const symbol of symbols) {
        const row = raw.find((entry) => entry?.symbol === symbol);
        result[symbol] = {
          nextEarningsDate: isoFromSeconds(
            typeof row?.nextEarningsDate === "number" ? row.nextEarningsDate : null
          ),
        };
      }
      return result;
    },
  };
}
