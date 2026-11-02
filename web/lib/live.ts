"use client";

import { useEffect, useState } from "react";

export type LiveCandle = {
  symbol: string;
  time: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  source: "schwab-stream";
};

export type LiveQuote = {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  time: number | null;
  source: "schwab-stream";
};

/**
 * Subscribe to Schwab level-one quotes through the Next SSE proxy. Returns
 * silently when Schwab is not configured; callers keep their regular polling
 * query as the fallback, so this hook is purely an enhancement.
 */
export function useLiveQuotes(symbols: string[]): {
  quotes: Record<string, LiveQuote>;
  connected: boolean;
} {
  const key = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean).join(",");
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const [connected, setConnected] = useState(false);
  const [receiving, setReceiving] = useState(false);

  useEffect(() => {
    setQuotes({});
    setConnected(false);
    setReceiving(false);
    if (!key) return;

    let source: EventSource | null = null;
    let active = true;
    let lastEventAt = 0;

    const clearStream = () => {
      setConnected(false);
      setReceiving(false);
      setQuotes({});
    };

    const onQuote = (event: MessageEvent) => {
      try {
        const quote = JSON.parse(event.data) as LiveQuote;
        if (!active || !quote.symbol) return;
        lastEventAt = Date.now();
        setReceiving(true);
        setQuotes((previous) => ({ ...previous, [quote.symbol]: quote }));
      } catch {
        // Ignore malformed events; EventSource will keep the stream open.
      }
    };

    const onStatus = (event: MessageEvent) => {
      try {
        const status = JSON.parse(event.data) as { connected?: boolean };
        if (!active) return;
        setConnected(Boolean(status.connected));
        if (!status.connected) {
          setReceiving(false);
          setQuotes({});
        }
      } catch {
        // ignore
      }
    };

    source = new EventSource(`/api/stream/quotes?symbols=${encodeURIComponent(key)}`);
    source.addEventListener("quote", onQuote as EventListener);
    source.addEventListener("status", onStatus as EventListener);
    source.onerror = () => {
      if (active) clearStream();
    };

    // A half-open stream must not keep overlaying old prices on REST data.
    const freshness = setInterval(() => {
      if (active && lastEventAt > 0 && Date.now() - lastEventAt > 90_000) {
        setReceiving(false);
        setQuotes({});
      }
    }, 15_000);

    return () => {
      active = false;
      clearInterval(freshness);
      source?.close();
    };
  }, [key]);

  return { quotes: receiving ? quotes : {}, connected: connected && receiving };
}

/**
 * Subscribe to the current one-minute CHART_EQUITY bar for a symbol. The
 * chart applies these updates in place; it keeps REST history for the older
 * candles and indicator calculations.
 */
export function useLiveCandle(symbol: string, enabled = true): {
  candle: LiveCandle | null;
  connected: boolean;
} {
  const [candle, setCandle] = useState<LiveCandle | null>(null);
  const [connected, setConnected] = useState(false);
  const [receiving, setReceiving] = useState(false);

  useEffect(() => {
    setCandle(null);
    setConnected(false);
    setReceiving(false);
    if (!symbol || !enabled) return;

    let source: EventSource | null = null;
    let active = true;
    let lastEventAt = 0;

    const onCandle = (event: MessageEvent) => {
      try {
        const next = JSON.parse(event.data) as LiveCandle;
        if (active && next.symbol && Number.isFinite(next.time)) {
          lastEventAt = Date.now();
          setReceiving(true);
          setCandle(next);
        }
      } catch {
        // Ignore malformed events; EventSource keeps the stream open.
      }
    };

    const onStatus = (event: MessageEvent) => {
      try {
        const status = JSON.parse(event.data) as { connected?: boolean };
        if (!active) return;
        setConnected(Boolean(status.connected));
        if (!status.connected) {
          setReceiving(false);
          setCandle(null);
        }
      } catch {
        // ignore
      }
    };

    source = new EventSource(`/api/stream/chart/${encodeURIComponent(symbol)}`);
    source.addEventListener("candle", onCandle as EventListener);
    source.addEventListener("status", onStatus as EventListener);
    source.onerror = () => {
      if (!active) return;
      setConnected(false);
      setReceiving(false);
      setCandle(null);
    };

    // If the socket is connected but chart frames stop arriving (market
    // closed, entitlement issue), fall back to REST polling instead of
    // freezing the chart.
    const freshness = setInterval(() => {
      if (active && lastEventAt > 0 && Date.now() - lastEventAt > 90_000) {
        setReceiving(false);
        setCandle(null);
      }
    }, 15_000);

    return () => {
      active = false;
      clearInterval(freshness);
      source?.close();
    };
  }, [symbol, enabled]);

  return { candle: receiving ? candle : null, connected: connected && receiving };
}

/**
 * Overlay streamed fields on a REST quote without letting a null from a
 * partial stream frame erase a good value from the initial snapshot.
 */
export function mergeLiveQuote<T extends { symbol: string }>(base: T, live: LiveQuote | undefined): T {
  if (!live) return base;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(live)) {
    if (key === "symbol" || key === "source" || value !== null) patch[key] = value;
  }
  return { ...base, ...patch };
}
