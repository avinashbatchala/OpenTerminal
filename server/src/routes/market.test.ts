import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { marketRouter } from "./market.js";

function fakeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function getHandler(path: string) {
  const layer = (marketRouter as any).stack.find((l: any) => l.route?.path === path);
  if (!layer) throw new Error(`no route registered for ${path}`);
  return layer.route.stack[0].handle as (req: Request, res: Response, next: () => void) => unknown;
}

describe("GET /crypto/orderbook/:symbol", () => {
  it("rejects a symbol outside the supported crypto whitelist with 400, before touching the network", async () => {
    const handler = getHandler("/crypto/orderbook/:symbol");
    const req = { params: { symbol: "AAA&limit=5000" } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "unsupported crypto symbol" });
  });

  it("accepts a whitelisted symbol (case-insensitive) and proceeds past validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bids: [], asks: [] }) })
    );
    try {
      const handler = getHandler("/crypto/orderbook/:symbol");
      const req = { params: { symbol: "btc" } } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      expect(res.status).not.toHaveBeenCalledWith(400);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function yahooCandles(start: number, count: number, spacing: number) {
  const timestamps = Array.from({ length: count }, (_, index) => start + index * spacing);
  return {
    chart: {
      result: [
        {
          timestamp: timestamps,
          indicators: {
            quote: [
              {
                open: timestamps.map(() => 100),
                high: timestamps.map(() => 101),
                low: timestamps.map(() => 99),
                close: timestamps.map(() => 100.5),
                volume: timestamps.map(() => 1000),
              },
            ],
          },
        },
      ],
    },
  };
}

function stubProviderFetch(yahooBody: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("query1.finance.yahoo.com")) {
        return { ok: true, status: 200, json: async () => yahooBody, text: async () => "" };
      }
      // Schwab, Nasdaq, and Stooq are unavailable in this scenario so the
      // history chain must reach Yahoo.
      throw new Error("provider unavailable in test");
    })
  );
}

describe("GET /history/:symbol interval gating", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns five-minute bars from a provider that honors the requested interval", async () => {
    const start = Date.UTC(2026, 10, 2, 14, 30) / 1000;
    stubProviderFetch(yahooCandles(start, 30, 300));
    const handler = getHandler("/history/:symbol");
    const req = { params: { symbol: "AAPL" }, query: { range: "1D", interval: "5m" } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).not.toHaveBeenCalled();
    const body = (res.json as any).mock.calls[0][0];
    expect(body).toHaveLength(30);
    expect(body[1].time - body[0].time).toBe(300);
  });

  it("rejects one-minute bars instead of relabeling them when 5m was requested", async () => {
    const start = Date.UTC(2026, 10, 2, 14, 30) / 1000;
    stubProviderFetch(yahooCandles(start, 30, 60));
    const handler = getHandler("/history/:symbol");
    const req = { params: { symbol: "MSFT" }, query: { range: "1D", interval: "5m" } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(502);
  });

  it("rejects an unsupported interval before touching a provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const handler = getHandler("/history/:symbol");
    const req = { params: { symbol: "NVDA" }, query: { range: "1D", interval: "banana" } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
