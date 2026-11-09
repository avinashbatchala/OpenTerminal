import {
  getSchwabAccessToken,
  getSchwabStreamerInfo,
  isSchwabConfigured,
  type SchwabStreamerInfo,
} from "./schwabAuth.js";

// Schwab's streaming API is a WebSocket whose protocol is close to the old
// TD Ameritrade one: log in with the OAuth access token, then SUBS/ADD/UNSUBS
// services such as LEVELONE_EQUITIES and CHART_EQUITY. This module keeps one
// upstream socket alive for all browser SSE clients and fans out updates.

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

/**
 * Level-one option quote keyed by the Schwab/OSI contract symbol. The
 * execution engine uses bid/ask to mark open option packages close to
 * real-time when Schwab streaming is available.
 */
export type LiveOptionQuote = {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  multiplier: number | null;
  underlyingPrice: number | null;
  quoteTime: number | null;
  source: "schwab-stream";
};

export type StreamerStatus = {
  configured: boolean;
  state: "idle" | "connecting" | "connected" | "error";
  connected: boolean;
  subscribed: string[];
  chartSubscribed: string[];
  optionSubscribed: string[];
  error: string | null;
};

type QuoteListener = (quote: LiveQuote) => void;
type CandleListener = (candle: LiveCandle) => void;
type OptionListener = (quote: LiveOptionQuote) => void;

type WebSocketLike = {
  send(data: string): void;
  close(): void;
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: { data?: unknown }) => void
  ): void;
};

type WebSocketCtor = new (url: string) => WebSocketLike;

// Fields requested from LEVELONE_EQUITIES. Sending the numeric ids keeps the
// payload small; responses can carry either numeric or named keys depending
// on the entitlement, so the parser accepts both.
const LEVEL_ONE_FIELDS = [
  0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 15, 17, 18, 19, 20, 21, 22, 23, 25, 34, 35, 42,
].join(",");

const CHART_EQUITY_FIELDS = [0, 1, 2, 3, 4, 5, 6, 7, 8].join(",");

// LEVELONE_OPTIONS: symbol, bid, ask, last, volume, open interest, multiplier,
// underlying price, quote time and mark. Bid/ask are the only fields marks
// need; the rest make the stream useful for diagnostics and future UI.
const OPTION_LEVEL_ONE_FIELDS = [0, 2, 3, 4, 8, 9, 13, 35, 37, 38].join(",");

const FIELD_MAP: Array<[keyof Omit<LiveQuote, "symbol" | "source">, string, number]> = [
  ["price", "LAST_PRICE", 3],
  ["bid", "BID_PRICE", 1],
  ["ask", "ASK_PRICE", 2],
  ["volume", "TOTAL_VOLUME", 8],
  ["open", "OPEN_PRICE", 17],
  ["high", "HIGH_PRICE", 10],
  ["low", "LOW_PRICE", 11],
  ["previousClose", "CLOSE_PRICE", 12],
  ["change", "NET_CHANGE", 18],
  ["changePercent", "NET_CHANGE_PERCENT", 42],
];

const TIME_FIELDS = [
  ["time", "TRADE_TIME_MILLIS", 35],
  ["time", "QUOTE_TIME_MILLIS", 34],
] as const;

function numeric(record: Record<string, unknown>, name: string, id: number): number | null {
  const value = record[name] ?? record[String(id)];
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseLevelOne(content: Record<string, unknown>): Partial<LiveQuote> & { symbol: string } | null {
  const symbol = String(content.key ?? content["0"] ?? content.SYMBOL ?? "").trim().toUpperCase();
  if (!symbol) return null;

  const patch: Partial<LiveQuote> & { symbol: string } = { symbol };
  for (const [key, name, id] of FIELD_MAP) {
    const value = numeric(content, name, id);
    if (value !== null) patch[key] = value;
  }

  for (const [key, name, id] of TIME_FIELDS) {
    const value = numeric(content, name, id);
    if (value !== null) {
      patch[key] = Math.round(value / 1000);
      break;
    }
  }

  if (patch.price !== undefined && patch.price !== null) {
    const price = patch.price;
    const previousClose = patch.previousClose;
    if (patch.changePercent === undefined && previousClose) {
      patch.changePercent = ((price - previousClose) / previousClose) * 100;
    }
    if (patch.change === undefined && previousClose !== undefined && previousClose !== null) {
      patch.change = price - previousClose;
    }
  }
  return patch;
}

export function parseLevelOneOption(
  content: Record<string, unknown>
): (Partial<LiveOptionQuote> & { symbol: string }) | null {
  const symbol = String(content.key ?? content["0"] ?? content.SYMBOL ?? "").trim().toUpperCase();
  if (!symbol) return null;

  const patch: Partial<LiveOptionQuote> & { symbol: string } = { symbol };
  for (const [key, name, id] of [
    ["bid", "BID_PRICE", 2],
    ["ask", "ASK_PRICE", 3],
    ["last", "LAST_PRICE", 4],
    ["multiplier", "MULTIPLIER", 13],
    ["underlyingPrice", "UNDERLYING_PRICE", 35],
  ] as const) {
    const value = numeric(content, name, id);
    if (value !== null) patch[key] = value;
  }

  const quoteTime = numeric(content, "QUOTE_TIME_MILLIS", 38);
  if (quoteTime !== null) patch.quoteTime = Math.round(quoteTime / 1000);
  return patch;
}

export function parseChartEquity(
  content: Record<string, unknown>
): (Partial<Omit<LiveCandle, "source">> & { symbol: string; time: number }) | null {
  const symbol = String(content.key ?? content["0"] ?? content.SYMBOL ?? "").trim().toUpperCase();
  const rawTime = numeric(content, "CHART_TIME_MILLIS", 7);
  if (!symbol || rawTime === null) return null;

  const patch: Partial<Omit<LiveCandle, "source">> & { symbol: string; time: number } = {
    symbol,
    time: Math.round(rawTime / 1000),
  };
  for (const [key, name, id] of [
    ["open", "OPEN_PRICE", 2],
    ["high", "HIGH_PRICE", 3],
    ["low", "LOW_PRICE", 4],
    ["close", "CLOSE_PRICE", 5],
    ["volume", "VOLUME", 6],
  ] as const) {
    const value = numeric(content, name, id);
    if (value !== null) patch[key] = value;
  }
  return patch;
}

function emptyQuote(symbol: string): LiveQuote {
  return {
    symbol,
    price: null,
    change: null,
    changePercent: null,
    bid: null,
    ask: null,
    volume: null,
    open: null,
    high: null,
    low: null,
    previousClose: null,
    time: null,
    source: "schwab-stream",
  };
}

function emptyCandle(symbol: string, time: number): LiveCandle {
  return {
    symbol,
    time,
    open: null,
    high: null,
    low: null,
    close: null,
    volume: null,
    source: "schwab-stream",
  };
}

function emptyOptionQuote(symbol: string): LiveOptionQuote {
  return {
    symbol,
    bid: null,
    ask: null,
    last: null,
    multiplier: null,
    underlyingPrice: null,
    quoteTime: null,
    source: "schwab-stream",
  };
}

function webSocketCtor(): WebSocketCtor {
  const ctor = (globalThis as unknown as { WebSocket?: WebSocketCtor }).WebSocket;
  if (!ctor) throw new Error("Node.js 22+ is required for the built-in WebSocket client");
  return ctor;
}

class SchwabStreamer {
  private ws: WebSocketLike | null = null;
  private info: SchwabStreamerInfo | null = null;
  private state: StreamerStatus["state"] = "idle";
  private lastError: string | null = null;
  private authenticated = false;
  private connecting: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private requestId = 0;
  private loginResolve: (() => void) | null = null;
  private loginReject: ((err: Error) => void) | null = null;

  private readonly quoteListeners = new Map<QuoteListener, Set<string>>();
  private readonly chartListeners = new Map<CandleListener, Set<string>>();
  private readonly optionListeners = new Map<OptionListener, Set<string>>();
  private readonly quoteSubscribed = new Set<string>();
  private readonly chartSubscribed = new Set<string>();
  private readonly optionSubscribed = new Set<string>();
  private readonly lastQuotes = new Map<string, LiveQuote>();
  private readonly lastCandles = new Map<string, LiveCandle>();
  private readonly lastOptionQuotes = new Map<string, LiveOptionQuote>();

  status(): StreamerStatus {
    return {
      configured: isSchwabConfigured(),
      state: this.state,
      connected: this.authenticated,
      subscribed: [...this.quoteSubscribed].sort(),
      chartSubscribed: [...this.chartSubscribed].sort(),
      optionSubscribed: [...this.optionSubscribed].sort(),
      error: this.lastError,
    };
  }

  subscribe(listener: QuoteListener, symbols: string[]): void {
    this.clearIdleTimer();
    const normalized = this.normalizeSymbols(symbols);
    this.quoteListeners.set(listener, new Set(normalized));

    for (const symbol of normalized) {
      const cached = this.lastQuotes.get(symbol);
      if (cached) listener(cached);
    }

    this.startIfConfigured();
    if (this.authenticated) {
      const missing = normalized.filter((s) => !this.quoteSubscribed.has(s));
      if (missing.length > 0) {
        const command = this.quoteSubscribed.size > 0 ? "ADD" : "SUBS";
        this.sendSubscription("LEVELONE_EQUITIES", missing, command);
      }
    }
  }

  unsubscribe(listener: QuoteListener): void {
    const previous = this.quoteListeners.get(listener);
    this.quoteListeners.delete(listener);
    if (!previous) return;

    const wanted = this.desiredSymbols(this.quoteListeners);
    const removed = [...previous].filter((s) => !wanted.has(s) && this.quoteSubscribed.has(s));
    if (removed.length > 0 && this.authenticated) {
      this.sendSubscription("LEVELONE_EQUITIES", removed, "UNSUBS");
      for (const symbol of removed) this.quoteSubscribed.delete(symbol);
    }
    this.scheduleIdleIfNeeded();
  }

  subscribeCandles(listener: CandleListener, symbols: string[]): void {
    this.clearIdleTimer();
    const normalized = this.normalizeSymbols(symbols);
    this.chartListeners.set(listener, new Set(normalized));

    for (const symbol of normalized) {
      const cached = this.lastCandles.get(symbol);
      if (cached) listener(cached);
    }

    this.startIfConfigured();
    if (this.authenticated) {
      const missing = normalized.filter((s) => !this.chartSubscribed.has(s));
      if (missing.length > 0) {
        // The first subscription for a service must be SUBS; ADD only extends
        // an existing subscription.
        const command = this.chartSubscribed.size > 0 ? "ADD" : "SUBS";
        this.sendSubscription("CHART_EQUITY", missing, command);
      }
    }
  }

  unsubscribeCandles(listener: CandleListener): void {
    const previous = this.chartListeners.get(listener);
    this.chartListeners.delete(listener);
    if (!previous) return;

    const wanted = this.desiredSymbols(this.chartListeners);
    const removed = [...previous].filter((s) => !wanted.has(s) && this.chartSubscribed.has(s));
    if (removed.length > 0 && this.authenticated) {
      this.sendSubscription("CHART_EQUITY", removed, "UNSUBS");
      for (const symbol of removed) this.chartSubscribed.delete(symbol);
    }
    this.scheduleIdleIfNeeded();
  }

  /** Subscribe to option contracts (Schwab/OSI symbols). */
  subscribeOptions(listener: OptionListener, symbols: string[]): void {
    this.clearIdleTimer();
    const normalized = this.normalizeSymbols(symbols);
    const previous = this.optionListeners.get(listener);
    this.optionListeners.set(listener, new Set(normalized));

    for (const symbol of normalized) {
      const cached = this.lastOptionQuotes.get(symbol);
      if (cached) listener(cached);
    }

    this.startIfConfigured();
    if (!this.authenticated) return;

    // Replacing a listener's symbol set must release contracts no other
    // listener still wants; otherwise closed trades keep streaming forever.
    if (previous) {
      const wanted = this.desiredSymbols(this.optionListeners);
      const removed = [...previous].filter((s) => !wanted.has(s) && this.optionSubscribed.has(s));
      if (removed.length > 0) {
        this.sendSubscription("LEVELONE_OPTIONS", removed, "UNSUBS");
        for (const symbol of removed) this.optionSubscribed.delete(symbol);
      }
    }

    const missing = normalized.filter((s) => !this.optionSubscribed.has(s));
    if (missing.length > 0) {
      const command = this.optionSubscribed.size > 0 ? "ADD" : "SUBS";
      this.sendSubscription("LEVELONE_OPTIONS", missing, command);
    }
  }

  unsubscribeOptions(listener: OptionListener): void {
    const previous = this.optionListeners.get(listener);
    this.optionListeners.delete(listener);
    if (!previous) return;

    const wanted = this.desiredSymbols(this.optionListeners);
    const removed = [...previous].filter((s) => !wanted.has(s) && this.optionSubscribed.has(s));
    if (removed.length > 0 && this.authenticated) {
      this.sendSubscription("LEVELONE_OPTIONS", removed, "UNSUBS");
      for (const symbol of removed) this.optionSubscribed.delete(symbol);
    }
    this.scheduleIdleIfNeeded();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private scheduleIdleIfNeeded(): void {
    if (this.hasListeners()) return;
    this.idleTimer = setTimeout(() => this.disconnect(), 60_000);
    this.idleTimer.unref();
  }

  private hasListeners(): boolean {
    return (
      this.quoteListeners.size > 0 ||
      this.chartListeners.size > 0 ||
      this.optionListeners.size > 0
    );
  }

  private normalizeSymbols(symbols: string[]): string[] {
    return [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 100);
  }

  private startIfConfigured(): void {
    if (!isSchwabConfigured()) {
      this.lastError = "Schwab streamer is not configured";
      return;
    }
    this.ensureConnected().catch((err: unknown) => {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.state = "error";
      this.scheduleReconnect();
    });
  }

  private desiredSymbols<T>(listeners: Map<T, Set<string>>): Set<string> {
    const out = new Set<string>();
    for (const symbols of listeners.values()) for (const symbol of symbols) out.add(symbol);
    return out;
  }

  private ensureConnected(): Promise<void> {
    if (this.authenticated && this.ws) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<void> {
    this.state = "connecting";
    this.lastError = null;

    const [token, info] = await Promise.all([getSchwabAccessToken(), getSchwabStreamerInfo()]);
    this.info = info;

    const ws = new (webSocketCtor())(info.streamerSocketUrl);
    this.ws = ws;

    const login = new Promise<void>((resolve, reject) => {
      this.loginResolve = resolve;
      this.loginReject = reject;
      const timer = setTimeout(() => reject(new Error("Schwab streamer login timed out")), 10_000);
      timer.unref();
      const clear = () => clearTimeout(timer);
      this.loginResolve = () => {
        clear();
        resolve();
      };
      this.loginReject = (err) => {
        clear();
        reject(err);
      };
    });

    ws.addEventListener("open", () => {
      this.sendRequest(
        "ADMIN",
        "LOGIN",
        {
          Authorization: token,
          SchwabClientChannel: info.schwabClientChannel,
          SchwabClientFunctionId: info.schwabClientFunctionId,
        },
        info
      );
    });

    ws.addEventListener("message", (event) => {
      const data = typeof event.data === "string" ? event.data : "";
      if (data) this.handleMessage(data);
    });

    ws.addEventListener("close", () => this.handleClose());
    ws.addEventListener("error", () => {
      this.lastError = "Schwab streamer socket error";
    });

    try {
      await login;
    } catch (err) {
      try {
        ws.close();
      } catch {
        // already closed
      }
      this.ws = null;
      throw err;
    }

    this.authenticated = true;
    this.quoteSubscribed.clear();
    this.chartSubscribed.clear();
    this.optionSubscribed.clear();
    this.state = "connected";
    this.lastError = null;

    const quotes = [...this.desiredSymbols(this.quoteListeners)];
    if (quotes.length > 0) this.sendSubscription("LEVELONE_EQUITIES", quotes, "SUBS");
    const charts = [...this.desiredSymbols(this.chartListeners)];
    if (charts.length > 0) this.sendSubscription("CHART_EQUITY", charts, "SUBS");
    const options = [...this.desiredSymbols(this.optionListeners)];
    if (options.length > 0) this.sendSubscription("LEVELONE_OPTIONS", options, "SUBS");
  }

  private sendRequest(
    service: string,
    command: string,
    parameters: Record<string, string>,
    info = this.info
  ): void {
    if (!this.ws || !info) return;
    const request = {
      service,
      command,
      requestid: String(++this.requestId),
      SchwabClientCustomerId: info.schwabClientCustomerId,
      SchwabClientCorrelId: info.schwabClientCorrelId,
      parameters,
    };
    this.ws.send(JSON.stringify({ requests: [request] }));
  }

  private sendSubscription(
    service: "LEVELONE_EQUITIES" | "CHART_EQUITY" | "LEVELONE_OPTIONS",
    symbols: string[],
    command: "SUBS" | "ADD" | "UNSUBS"
  ): void {
    if (symbols.length === 0) return;
    const parameters: Record<string, string> = { keys: symbols.join(",") };
    if (command !== "UNSUBS") {
      parameters.fields =
        service === "LEVELONE_EQUITIES"
          ? LEVEL_ONE_FIELDS
          : service === "LEVELONE_OPTIONS"
            ? OPTION_LEVEL_ONE_FIELDS
            : CHART_EQUITY_FIELDS;
    }
    this.sendRequest(service, command, parameters);
    if (command !== "UNSUBS") {
      const set =
        service === "LEVELONE_EQUITIES"
          ? this.quoteSubscribed
          : service === "LEVELONE_OPTIONS"
            ? this.optionSubscribed
            : this.chartSubscribed;
      for (const symbol of symbols) set.add(symbol);
    }
  }

  private handleMessage(raw: string): void {
    let message: {
      response?: Array<Record<string, any>>;
      data?: Array<Record<string, any>>;
    };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    for (const response of message.response ?? []) {
      if (response.service !== "ADMIN" || response.command !== "LOGIN") continue;
      const code = Number(response.content?.code ?? -1);
      if (code === 0) {
        this.loginResolve?.();
      } else {
        this.loginReject?.(
          new Error(`Schwab streamer login failed: ${response.content?.msg ?? `code ${code}`}`)
        );
      }
      this.loginResolve = null;
      this.loginReject = null;
    }

    for (const event of message.data ?? []) {
      const content = Array.isArray(event.content) ? event.content : [event.content];

      if (event.service === "LEVELONE_EQUITIES") {
        for (const row of content) {
          if (!row || typeof row !== "object") continue;
          const patch = parseLevelOne(row as Record<string, unknown>);
          if (!patch || Object.keys(patch).length === 1) continue;

          const previous = this.lastQuotes.get(patch.symbol) ?? emptyQuote(patch.symbol);
          const next: LiveQuote = {
            ...previous,
            ...patch,
            source: "schwab-stream",
          };
          this.lastQuotes.set(next.symbol, next);

          for (const [listener, symbols] of this.quoteListeners) {
            if (symbols.has(next.symbol)) listener(next);
          }
        }
      } else if (event.service === "CHART_EQUITY") {
        for (const row of content) {
          if (!row || typeof row !== "object") continue;
          const patch = parseChartEquity(row as Record<string, unknown>);
          if (!patch) continue;

          const previous = this.lastCandles.get(patch.symbol);
          const base = previous && previous.time === patch.time
            ? previous
            : emptyCandle(patch.symbol, patch.time);
          const next: LiveCandle = {
            ...base,
            ...patch,
            source: "schwab-stream",
          };
          this.lastCandles.set(next.symbol, next);

          for (const [listener, symbols] of this.chartListeners) {
            if (symbols.has(next.symbol)) listener(next);
          }
        }
      } else if (event.service === "LEVELONE_OPTIONS") {
        for (const row of content) {
          if (!row || typeof row !== "object") continue;
          const patch = parseLevelOneOption(row as Record<string, unknown>);
          if (!patch || Object.keys(patch).length === 1) continue;

          const previous =
            this.lastOptionQuotes.get(patch.symbol) ?? emptyOptionQuote(patch.symbol);
          const next: LiveOptionQuote = {
            ...previous,
            ...patch,
            source: "schwab-stream",
          };
          this.lastOptionQuotes.set(next.symbol, next);

          for (const [listener, symbols] of this.optionListeners) {
            if (symbols.has(next.symbol)) listener(next);
          }
        }
      }
    }
  }

  private handleClose(): void {
    this.authenticated = false;
    this.ws = null;
    this.quoteSubscribed.clear();
    this.chartSubscribed.clear();
    this.optionSubscribed.clear();
    this.loginReject?.(new Error("Schwab streamer socket closed"));
    this.loginResolve = null;
    this.loginReject = null;

    if (!this.hasListeners()) {
      this.state = "idle";
      return;
    }

    this.state = "error";
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.hasListeners()) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected().catch((err: unknown) => {
        this.lastError = err instanceof Error ? err.message : String(err);
        this.state = "error";
        this.scheduleReconnect();
      });
    }, 5_000);
    this.reconnectTimer.unref();
  }

  private disconnect(): void {
    if (this.ws) {
      try {
        this.sendRequest("ADMIN", "LOGOUT", {});
      } catch {
        // Socket may already be closed.
      }
      this.ws.close();
    }
    this.ws = null;
    this.authenticated = false;
    this.quoteSubscribed.clear();
    this.chartSubscribed.clear();
    this.optionSubscribed.clear();
    this.state = "idle";
    this.lastError = null;
  }
}

export const schwabStreamer = new SchwabStreamer();
