import { Router } from "express";
import type { ExecutionMarkEvent } from "../execution/types.js";
import { isSchwabConfigured } from "../providers/schwabAuth.js";
import { schwabStreamer, type LiveCandle, type LiveQuote } from "../providers/schwabStreamer.js";
import { getSettings } from "../settings.js";
import { executionEngine } from "./execution.js";

export const streamRouter = Router();

/**
 * Live execution marks. This works with or without Schwab: the execution
 * engine streams quote-driven marks when the option WebSocket is available and
 * falls back to polling the chain. The browser gets the same event shape either
 * way, so the Paper widget does not need to know which source is active.
 */
streamRouter.get("/execution", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded && !res.destroyed) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  res.write("retry: 5000\n\n");
  send("snapshot", executionEngine.markSnapshot());

  const listener = (event: ExecutionMarkEvent) => {
    if (event.type === "mark") send("mark", event.mark);
    else send("equity", event.equity);
  };
  const unsubscribe = executionEngine.subscribeMarks(listener);

  // A periodic snapshot catches clients that reconnected between events and
  // keeps the streamer/POLLING indicator current.
  const snapshotTimer = setInterval(() => {
    send("snapshot", executionEngine.markSnapshot());
  }, 5_000);
  snapshotTimer.unref();

  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(": ping\n\n");
  }, 15_000);
  heartbeat.unref();

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(snapshotTimer);
    clearInterval(heartbeat);
    unsubscribe();
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);
});

// Server-Sent Events rather than a browser WebSocket: the shared API key must
// stay server-side, so EventSource talks to the Next proxy, which forwards the
// request to this endpoint with the key attached. The Next route handler
// streams text/event-stream responses through without buffering.
streamRouter.get("/quotes", (req, res) => {
  const symbols = String(req.query.symbols ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 100);

  if (symbols.length === 0) {
    res.status(400).json({ error: "symbols required" });
    return;
  }
  if (getSettings().dataSource === "public") {
    res.status(503).json({ error: "Public data mode is selected in Settings" });
    return;
  }
  if (!isSchwabConfigured()) {
    res.status(503).json({ error: "Schwab streaming is not configured" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded && !res.destroyed) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  res.write("retry: 10000\n\n");
  const initialStatus = schwabStreamer.status();
  let lastStatus = `${initialStatus.state}:${initialStatus.connected}`;
  send("status", initialStatus);

  const listener = (quote: LiveQuote) => send("quote", quote);
  schwabStreamer.subscribe(listener, symbols);

  // The upstream socket can connect a moment after this SSE response starts;
  // push status changes so the browser can switch from REST polling to live.
  const statusTimer = setInterval(() => {
    if (getSettings().dataSource === "public") {
      send("mode", { mode: "public" });
      cleanup();
      res.end();
      return;
    }
    const status = schwabStreamer.status();
    const key = `${status.state}:${status.connected}`;
    if (key === lastStatus) return;
    lastStatus = key;
    send("status", status);
  }, 1_000);
  statusTimer.unref();

  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(": ping\n\n");
  }, 15_000);
  heartbeat.unref();

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(statusTimer);
    clearInterval(heartbeat);
    schwabStreamer.unsubscribe(listener);
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);
});

streamRouter.get("/chart/:symbol", (req, res) => {
  const symbol = String(req.params.symbol ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) {
    res.status(400).json({ error: "invalid symbol" });
    return;
  }
  if (getSettings().dataSource === "public") {
    res.status(503).json({ error: "Public data mode is selected in Settings" });
    return;
  }
  if (!isSchwabConfigured()) {
    res.status(503).json({ error: "Schwab streaming is not configured" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded && !res.destroyed) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  res.write("retry: 10000\n\n");
  const initialStatus = schwabStreamer.status();
  let lastStatus = `${initialStatus.state}:${initialStatus.connected}`;
  send("status", initialStatus);

  const listener = (candle: LiveCandle) => send("candle", candle);
  schwabStreamer.subscribeCandles(listener, [symbol]);

  const statusTimer = setInterval(() => {
    if (getSettings().dataSource === "public") {
      send("mode", { mode: "public" });
      cleanup();
      res.end();
      return;
    }
    const status = schwabStreamer.status();
    const key = `${status.state}:${status.connected}`;
    if (key === lastStatus) return;
    lastStatus = key;
    send("status", status);
  }, 1_000);
  statusTimer.unref();

  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(": ping\n\n");
  }, 15_000);
  heartbeat.unref();

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(statusTimer);
    clearInterval(heartbeat);
    schwabStreamer.unsubscribeCandles(listener);
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);
});
