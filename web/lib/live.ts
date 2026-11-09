"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const STALE_STREAM_MS = 90_000;

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

type QuoteListener = {
  symbols: Set<string>;
  onQuote: (quote: LiveQuote) => void;
  onStatus: (connected: boolean) => void;
  onSnapshot: (quotes: Record<string, LiveQuote>) => void;
};

/**
 * One shared EventSource for every quote subscriber. Individual widgets can
 * request different symbol sets; the manager streams the union and fans
 * frames out. This keeps the dashboard within the browser's per-origin
 * connection limit instead of holding one SSE connection per widget.
 */
const quoteListeners = new Set<QuoteListener>();
const quoteLatest = new Map<string, LiveQuote>();
let quoteSource: EventSource | null = null;
let quoteKey = "";
let quoteConnected = false;

function snapshotFor(listener: QuoteListener): Record<string, LiveQuote> {
  const snapshot: Record<string, LiveQuote> = {};
  for (const symbol of listener.symbols) {
    const quote = quoteLatest.get(symbol);
    if (quote) snapshot[symbol] = quote;
  }
  return snapshot;
}

function replayQuoteListener(listener: QuoteListener) {
  listener.onStatus(quoteConnected);
  const snapshot = snapshotFor(listener);
  if (Object.keys(snapshot).length > 0) listener.onSnapshot(snapshot);
}

function syncQuoteStream() {
  const union = new Set<string>();
  for (const listener of quoteListeners) {
    for (const symbol of listener.symbols) union.add(symbol);
  }
  const key = [...union].sort().join(",");
  if (key === quoteKey) return;

  quoteSource?.close();
  quoteSource = null;
  quoteKey = key;
  quoteConnected = false;
  // Keep the last frames: a subscriber that joins while the union changes can
  // use them immediately, and the 90s freshness window bounds their age.
  for (const listener of quoteListeners) listener.onStatus(false);
  if (!key) return;

  quoteSource = new EventSource(`/api/stream/quotes?symbols=${encodeURIComponent(key)}`);
  quoteSource.addEventListener("quote", (event) => {
    try {
      const quote = JSON.parse((event as MessageEvent).data) as LiveQuote;
      if (!quote.symbol) return;
      quoteLatest.set(quote.symbol, quote);
      for (const listener of quoteListeners) {
        if (listener.symbols.has(quote.symbol)) listener.onQuote(quote);
      }
    } catch {
      // Ignore malformed frames; the stream stays open.
    }
  });
  quoteSource.addEventListener("status", (event) => {
    try {
      const status = JSON.parse((event as MessageEvent).data) as { connected?: boolean };
      quoteConnected = Boolean(status.connected);
      if (!quoteConnected) quoteLatest.clear();
      for (const listener of quoteListeners) {
        listener.onStatus(quoteConnected);
        if (quoteConnected) {
          const snapshot = snapshotFor(listener);
          if (Object.keys(snapshot).length > 0) listener.onSnapshot(snapshot);
        }
      }
    } catch {
      // ignore
    }
  });
  quoteSource.onerror = () => {
    quoteConnected = false;
    quoteLatest.clear();
    for (const listener of quoteListeners) listener.onStatus(false);
  };
}

function addQuoteListener(listener: QuoteListener) {
  quoteListeners.add(listener);
  syncQuoteStream();
  if (quoteSource) replayQuoteListener(listener);
}

function removeQuoteListener(listener: QuoteListener) {
  quoteListeners.delete(listener);
  syncQuoteStream();
}

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
  const [freshnessTick, setFreshnessTick] = useState(0);
  const lastSeenRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    lastSeenRef.current.clear();
    setQuotes({});
    setConnected(false);
    setReceiving(false);
    if (!key) return;

    let active = true;

    const onQuote = (quote: LiveQuote) => {
      if (!active) return;
      lastSeenRef.current.set(quote.symbol, Date.now());
      setReceiving(true);
      setQuotes((previous) => ({ ...previous, [quote.symbol]: quote }));
    };

    const onStatus = (isConnected: boolean) => {
      if (!active) return;
      setConnected(isConnected);
      if (!isConnected) {
        lastSeenRef.current.clear();
        setReceiving(false);
        setQuotes({});
      }
    };

    const onSnapshot = (snapshot: Record<string, LiveQuote>) => {
      if (!active) return;
      const seenAt = Date.now();
      for (const symbol of Object.keys(snapshot)) lastSeenRef.current.set(symbol, seenAt);
      setReceiving(true);
      setQuotes((previous) => ({ ...previous, ...snapshot }));
    };

    const listener: QuoteListener = {
      symbols: new Set(key.split(",")),
      onQuote,
      onStatus,
      onSnapshot,
    };
    addQuoteListener(listener);

    // Expire each symbol independently: an active MSFT stream must not keep a
    // stale AAPL quote alive in the same watchlist subscription.
    const freshness = setInterval(() => {
      if (!active) return;
      const cutoff = Date.now() - STALE_STREAM_MS;
      let hasFresh = false;
      for (const [symbol, seenAt] of lastSeenRef.current) {
        if (seenAt > cutoff) hasFresh = true;
        else lastSeenRef.current.delete(symbol);
      }
      setQuotes((previous) => {
        const next: Record<string, LiveQuote> = {};
        for (const symbol of Object.keys(previous)) {
          if (lastSeenRef.current.has(symbol)) next[symbol] = previous[symbol];
        }
        return next;
      });
      if (!hasFresh) setReceiving(false);
      setFreshnessTick((tick) => tick + 1);
    }, 15_000);

    return () => {
      active = false;
      clearInterval(freshness);
      removeQuoteListener(listener);
    };
  }, [key]);

  const freshQuotes = useMemo(() => {
    const cutoff = Date.now() - STALE_STREAM_MS;
    const next: Record<string, LiveQuote> = {};
    for (const [symbol, quote] of Object.entries(quotes)) {
      if ((lastSeenRef.current.get(symbol) ?? 0) > cutoff) next[symbol] = quote;
    }
    return next;
    // freshnessTick forces re-evaluation even when no new quote arrives.
  }, [quotes, freshnessTick]);

  return { quotes: receiving ? freshQuotes : {}, connected: connected && receiving };
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
      if (active && lastEventAt > 0 && Date.now() - lastEventAt > STALE_STREAM_MS) {
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
