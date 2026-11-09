"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  AreaSeries,
  BarSeries,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { apiGet, fmt, fmtBig, type Candle, type Quote } from "../../lib/api";
import { mergeLiveQuote, useLiveCandle, useLiveQuotes, type LiveCandle } from "../../lib/live";
import { sma, ema, vwap, rsi, macd, bollinger, type Point } from "../../lib/indicators";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

const RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;
const CHART_TYPES = ["candles", "bars", "line", "area"] as const;
const INDICATORS = ["SMA20", "SMA50", "SMA200", "EMA20", "VWAP", "BOLL", "RSI", "MACD"] as const;

type Range = (typeof RANGES)[number];
type ChartType = (typeof CHART_TYPES)[number];
type Indicator = (typeof INDICATORS)[number];
type ChartQuote = Pick<Quote, "symbol" | "price" | "open" | "high" | "low" | "volume">;

const ts = (t: number) => t as UTCTimestamp;
const toMap = (pts: Point[]) => new Map(pts.map((p) => [p.time, p.value]));

function candleFromLive(live: LiveCandle): Candle | null {
  if (live.close === null) return null;
  return {
    time: live.time,
    open: live.open ?? live.close,
    high: live.high ?? live.close,
    low: live.low ?? live.close,
    close: live.close,
    volume: live.volume ?? 0,
  };
}

function newYorkParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function timeZoneOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUTC = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return (asUTC - date.getTime()) / 60_000;
}

function newYorkMidnightSeconds(year: number, month: number, day: number): number {
  const guess = Date.UTC(year, month - 1, day);
  const offset = timeZoneOffsetMinutes(new Date(guess + 12 * 3_600_000));
  return Math.round((guess - offset * 60_000) / 1000);
}

function currentBucketTime(range: Range, now = new Date()): number {
  const { year, month, day } = newYorkParts(now);
  const midnight = newYorkMidnightSeconds(year, month, day);
  if (range === "1M" || range === "6M" || range === "YTD" || range === "1Y") {
    return midnight;
  }
  if (range === "5Y") {
    const weekday = new Date(midnight * 1000).getUTCDay();
    return midnight - ((weekday + 6) % 7) * 86_400;
  }
  return newYorkMidnightSeconds(year, month, 1);
}

const INDICATOR_COLOR: Record<string, string> = {
  SMA20: "#ffd60a", SMA50: "#64d2ff", SMA200: "#bf5af2", EMA20: "#ff9f0a",
  VWAP: "#66d9d0", RSI: "#ff9f0a", BOLL: "#ff9f0a", MACD: "#64d2ff",
};

const UP_COLOR = "#30d158";
const DOWN_COLOR = "#ff453a";
const ACCENT_COLOR = "#ff9f0a";

export default function ChartWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const [range, setRange] = useState<Range>("1D");
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [active, setActive] = useState<Set<Indicator>>(new Set(["SMA20"]));
  const [legend, setLegend] = useState<Candle | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const lastCandleTimeRef = useRef(0);
  const lastCandleRef = useRef<Candle | null>(null);
  const hoveringRef = useRef(false);
  const liveCandleRef = useRef<LiveCandle | null>(null);
  const liveQuoteRef = useRef<ChartQuote | null>(null);

  const intraday = range === "1D" || range === "5D";
  const { candle: liveCandle, connected: liveConnected } = useLiveCandle(symbol, intraday);
  const { quotes: liveQuotes, connected: quoteConnected } = useLiveQuotes([symbol]);
  // Share the quote widget's query and polling cadence, including when SSE
  // is unavailable (public providers, disconnected socket, or no Schwab auth).
  const { data: quoteSnapshot } = useQuery({
    queryKey: ["quote", symbol],
    queryFn: async () => (await apiGet<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(symbol)}`))[0],
    refetchInterval: quoteConnected ? 15_000 : 1_000,
  });
  const liveQuote = useMemo(
    () => quoteSnapshot ? mergeLiveQuote(quoteSnapshot, liveQuotes[symbol]) : liveQuotes[symbol],
    [quoteSnapshot, liveQuotes, symbol]
  );
  const chartLive = (intraday && liveConnected) || (quoteConnected && liveQuotes[symbol]?.price != null);
  const lastLivePrice = liveQuote?.price ?? liveCandle?.close ?? null;

  const { data: candles, error } = useQuery({
    queryKey: ["history", symbol, range],
    queryFn: () => apiGet<Candle[]>(`/api/history/${encodeURIComponent(symbol)}?range=${range}`),
    // Streaming updates the current bar in place. Polling remains the fallback
    // when Schwab streaming is unavailable, and a slow refresh repairs gaps.
    refetchInterval: chartLive ? 60_000 : range === "1D" ? 8_000 : 60_000,
  });

  // Fast time -> candle lookup for the crosshair legend, independent of chart type.
  const byTime = useMemo(() => {
    const m = new Map<number, Candle>();
    for (const c of candles ?? []) m.set(c.time, c);
    return m;
  }, [candles]);

  // Computed once per candles/active change, shared by both the chart overlays
  // below and the hover legend - avoids recomputing the same series twice.
  const indicatorData = useMemo(() => {
    if (!candles || candles.length === 0) return null;
    return {
      SMA20: active.has("SMA20") ? sma(candles, 20) : null,
      SMA50: active.has("SMA50") ? sma(candles, 50) : null,
      SMA200: active.has("SMA200") ? sma(candles, 200) : null,
      EMA20: active.has("EMA20") ? ema(candles, 20) : null,
      VWAP: active.has("VWAP") ? vwap(candles) : null,
      RSI: active.has("RSI") ? rsi(candles) : null,
      BOLL: active.has("BOLL") ? bollinger(candles) : null,
      MACD: active.has("MACD") ? macd(candles) : null,
    };
  }, [candles, active]);

  const indicatorMaps = useMemo(() => {
    const maps: Record<string, Map<number, number>> = {};
    if (!indicatorData) return maps;
    if (indicatorData.SMA20) maps.SMA20 = toMap(indicatorData.SMA20);
    if (indicatorData.SMA50) maps.SMA50 = toMap(indicatorData.SMA50);
    if (indicatorData.SMA200) maps.SMA200 = toMap(indicatorData.SMA200);
    if (indicatorData.EMA20) maps.EMA20 = toMap(indicatorData.EMA20);
    if (indicatorData.VWAP) maps.VWAP = toMap(indicatorData.VWAP);
    if (indicatorData.RSI) maps.RSI = toMap(indicatorData.RSI);
    if (indicatorData.BOLL) {
      maps.BOLL_U = toMap(indicatorData.BOLL.upper);
      maps.BOLL_M = toMap(indicatorData.BOLL.middle);
      maps.BOLL_L = toMap(indicatorData.BOLL.lower);
    }
    if (indicatorData.MACD) {
      maps.MACD_M = toMap(indicatorData.MACD.macd);
      maps.MACD_S = toMap(indicatorData.MACD.signal);
      maps.MACD_H = toMap(indicatorData.MACD.histogram);
    }
    return maps;
  }, [indicatorData]);

  const indicatorRows = useMemo(() => {
    if (!legend) return [];
    const t = legend.time;
    const get = (key: string) => indicatorMaps[key]?.get(t);
    const rows: Array<{ label: string; value: string; color: string }> = [];
    for (const key of ["SMA20", "SMA50", "SMA200", "EMA20", "VWAP"] as const) {
      const v = get(key);
      if (v !== undefined) rows.push({ label: key, value: fmt(v), color: INDICATOR_COLOR[key] });
    }
    const rsiV = get("RSI");
    if (rsiV !== undefined) rows.push({ label: "RSI", value: fmt(rsiV, 1), color: INDICATOR_COLOR.RSI });
    const bollM = get("BOLL_M");
    if (bollM !== undefined) {
      rows.push({
        label: "BOLL",
        value: `${fmt(get("BOLL_U"))} / ${fmt(bollM)} / ${fmt(get("BOLL_L"))}`,
        color: INDICATOR_COLOR.BOLL,
      });
    }
    const macdM = get("MACD_M");
    if (macdM !== undefined) {
      rows.push({
        label: "MACD",
        value: `${fmt(macdM, 2)} / ${fmt(get("MACD_S"), 2)} / ${fmt(get("MACD_H"), 2)}`,
        color: INDICATOR_COLOR.MACD,
      });
    }
    return rows;
  }, [legend, indicatorMaps]);

  const applyLiveCandle = useCallback(
    (live: LiveCandle) => {
      const series = mainSeriesRef.current;
      const candle = candleFromLive(live);
      if (!intraday || !series || !candle || live.symbol !== symbol || live.time < lastCandleTimeRef.current) return;

      lastCandleTimeRef.current = live.time;
      const time = ts(live.time);
      if (chartType === "candles" || chartType === "bars") {
        series.update({
          time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        });
      } else {
        series.update({ time, value: candle.close });
      }

      volumeSeriesRef.current?.update({
        time,
        value: candle.volume,
        color: candle.close >= candle.open ? "rgba(48,209,88,0.32)" : "rgba(255,69,58,0.32)",
      });

      lastCandleRef.current = candle;
      if (!hoveringRef.current) setLegend(candle);
    },
    [chartType, symbol, intraday]
  );

  const applyLiveQuote = useCallback(
    (quote: ChartQuote | null | undefined) => {
      if (!quote || quote.symbol !== symbol || quote.price === null) return;
      const series = mainSeriesRef.current;
      if (!series) return;

      const price = quote.price;
      const last = lastCandleRef.current;
      let bucket: number;
      let candle: Candle;
      let isNew: boolean;
      let updateVolume: boolean;

      if (intraday) {
        // LEVELONE quotes arrive every second. Use them to move the current
        // minute bar even before CHART_EQUITY sends its next frame.
        bucket = Math.floor(Date.now() / 60_000) * 60;
        if (!last || bucket < last.time) return;
        isNew = bucket > last.time;
        candle = isNew
          ? { time: bucket, open: price, high: price, low: price, close: price, volume: 0 }
          : {
              ...last,
              close: price,
              high: Math.max(last.high, price),
              low: Math.min(last.low, price),
            };
        updateVolume = isNew;
      } else {
        bucket = currentBucketTime(range);
        isNew = !last || bucket > last.time;
        if (isNew) {
          candle = {
            time: bucket,
            open: quote.open ?? price,
            high: Math.max(quote.high ?? price, price),
            low: Math.min(quote.low ?? price, price),
            close: price,
            volume: quote.volume ?? 0,
          };
        } else if (last && bucket === last.time) {
          candle = {
            ...last,
            close: price,
            high: Math.max(last.high, quote.high ?? price, price),
            low: Math.min(last.low, quote.low ?? price, price),
          };
          if (range !== "5Y" && range !== "MAX") candle.volume = quote.volume ?? last.volume;
        } else {
          return;
        }
        updateVolume = isNew || (range !== "5Y" && range !== "MAX");
      }

      lastCandleRef.current = candle;
      lastCandleTimeRef.current = candle.time;
      const time = ts(candle.time);
      if (chartType === "candles" || chartType === "bars") {
        series.update({
          time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        });
      } else {
        series.update({ time, value: candle.close });
      }

      if (updateVolume) {
        volumeSeriesRef.current?.update({
          time,
          value: candle.volume,
          color: candle.close >= candle.open ? "rgba(48,209,88,0.32)" : "rgba(255,69,58,0.32)",
        });
      }
      if (!hoveringRef.current) setLegend(candle);
    },
    [chartType, intraday, range, symbol]
  );

  useEffect(() => {
    liveCandleRef.current = liveCandle;
    if (liveCandle) applyLiveCandle(liveCandle);
  }, [liveCandle, applyLiveCandle]);

  useEffect(() => {
    liveQuoteRef.current = liveQuote ?? null;
    if (liveQuote) applyLiveQuote(liveQuote);
  }, [liveQuote, applyLiveQuote]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !candles || candles.length === 0) return;

    const chart = createChart(el, {
      layout: { background: { color: "#000000" }, textColor: "#8e8e93", fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: "#1c1c1e" }, horzLines: { color: "#1c1c1e" } },
      crosshair: { mode: 0 },
      timeScale: { borderColor: "#3a3a3c", timeVisible: range === "1D" || range === "5D" },
      rightPriceScale: { borderColor: "#3a3a3c" },
      autoSize: true,
      // Mouse-wheel is left free for page scrolling - zoom via drag, pinch, or the range buttons instead.
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    });
    chartRef.current = chart;

    const upColor = UP_COLOR;
    const downColor = DOWN_COLOR;

    if (chartType === "candles") {
      const series = chart.addSeries(CandlestickSeries, {
        upColor, downColor, borderUpColor: upColor, borderDownColor: downColor,
        wickUpColor: upColor, wickDownColor: downColor,
      });
      series.setData(candles.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
      mainSeriesRef.current = series;
    } else if (chartType === "bars") {
      const series = chart.addSeries(BarSeries, { upColor, downColor });
      series.setData(candles.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
      mainSeriesRef.current = series;
    } else if (chartType === "line") {
      const series = chart.addSeries(LineSeries, { color: ACCENT_COLOR, lineWidth: 1 });
      series.setData(candles.map((c) => ({ time: ts(c.time), value: c.close })));
      mainSeriesRef.current = series;
    } else {
      const series = chart.addSeries(AreaSeries, { lineColor: ACCENT_COLOR, topColor: "rgba(255,159,10,0.18)", bottomColor: "rgba(255,159,10,0)" });
      series.setData(candles.map((c) => ({ time: ts(c.time), value: c.close })));
      mainSeriesRef.current = series;
    }

    // volume histogram on its own scale at the bottom of the main pane
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" } });
    volumeSeriesRef.current = vol;
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    vol.setData(
      candles.map((c) => ({ time: ts(c.time), value: c.volume, color: c.close >= c.open ? "rgba(48,209,88,0.32)" : "rgba(255,69,58,0.32)" }))
    );
    lastCandleTimeRef.current = candles[candles.length - 1].time;
    lastCandleRef.current = candles[candles.length - 1];
    hoveringRef.current = false;
    setLegend(lastCandleRef.current);

    const overlay = (points: Point[], color: string) =>
      chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        .setData(points.map((p) => ({ time: ts(p.time), value: p.value })));

    if (indicatorData?.SMA20) overlay(indicatorData.SMA20, INDICATOR_COLOR.SMA20);
    if (indicatorData?.SMA50) overlay(indicatorData.SMA50, INDICATOR_COLOR.SMA50);
    if (indicatorData?.SMA200) overlay(indicatorData.SMA200, INDICATOR_COLOR.SMA200);
    if (indicatorData?.EMA20) overlay(indicatorData.EMA20, INDICATOR_COLOR.EMA20);
    if (indicatorData?.VWAP) overlay(indicatorData.VWAP, INDICATOR_COLOR.VWAP);
    if (indicatorData?.BOLL) {
      overlay(indicatorData.BOLL.upper, "rgba(255,159,10,0.45)");
      overlay(indicatorData.BOLL.middle, "rgba(255,159,10,0.75)");
      overlay(indicatorData.BOLL.lower, "rgba(255,159,10,0.45)");
    }

    let paneIdx = 1;
    if (indicatorData?.RSI) {
      const s = chart.addSeries(LineSeries, { color: INDICATOR_COLOR.RSI, lineWidth: 1 }, paneIdx++);
      s.setData(indicatorData.RSI.map((p) => ({ time: ts(p.time), value: p.value })));
    }
    if (indicatorData?.MACD) {
      const m = indicatorData.MACD;
      const pane = paneIdx++;
      chart.addSeries(HistogramSeries, { color: "#64d2ff" }, pane).setData(
        m.histogram.map((p) => ({ time: ts(p.time), value: p.value, color: p.value >= 0 ? "rgba(48,209,88,0.5)" : "rgba(255,69,58,0.5)" }))
      );
      chart.addSeries(LineSeries, { color: ACCENT_COLOR, lineWidth: 1 }, pane).setData(
        m.macd.map((p) => ({ time: ts(p.time), value: p.value }))
      );
      chart.addSeries(LineSeries, { color: "#d1d1d6", lineWidth: 1 }, pane).setData(
        m.signal.map((p) => ({ time: ts(p.time), value: p.value }))
      );
    }

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        hoveringRef.current = false;
        setLegend(lastCandleRef.current);
        return;
      }
      hoveringRef.current = true;
      const hit = lastCandleRef.current?.time === param.time
        ? lastCandleRef.current
        : byTime.get(param.time as number);
      if (hit) setLegend(hit);
    });

    chart.timeScale().fitContent();
    if (liveCandleRef.current) {
      applyLiveCandle(liveCandleRef.current);
      chart.timeScale().fitContent();
    }
    if (liveQuoteRef.current) {
      applyLiveQuote(liveQuoteRef.current);
      chart.timeScale().fitContent();
    }

    return () => {
      chart.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [candles, chartType, indicatorData, range, byTime, applyLiveCandle, applyLiveQuote]);

  const toggleIndicator = (ind: Indicator) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(ind)) next.delete(ind);
      else next.add(ind);
      return next;
    });

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 flex-wrap shrink-0">
        {RANGES.map((r) => (
          <button key={r} className={`term-btn ${range === r ? "active" : ""}`} onClick={() => setRange(r)}>
            {r}
          </button>
        ))}
        <span className="w-2" />
        {CHART_TYPES.map((t) => (
          <button key={t} className={`term-btn ${chartType === t ? "active" : ""}`} onClick={() => setChartType(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
        <span className="w-2" />
        {INDICATORS.map((ind) => (
          <button key={ind} className={`term-btn ${active.has(ind) ? "active" : ""}`} onClick={() => toggleIndicator(ind)}>
            {ind}
          </button>
        ))}
        <span
          className={`ml-auto text-[10px] ${chartLive ? "up" : "dim"}`}
          data-live={chartLive ? "1" : "0"}
          data-live-price={lastLivePrice ?? ""}
          title={chartLive ? "Streaming updates" : "REST polling fallback"}
        >
          {chartLive ? `● Live ${fmt(lastLivePrice)}` : "○ REST"}
        </span>
      </div>
      {error && <div className="p-2 down">Error: {(error as Error).message}</div>}
      <div className="relative flex-1 min-h-0">
        {legend && (
          <div className="absolute top-1 left-2 z-10 flex flex-col gap-0.5 text-[11px] pointer-events-none bg-[var(--edge-scrim)] px-2 py-1 rounded max-w-[95%]">
            <div className="flex gap-3">
              <span className="dim">O <span className="text-[var(--text)]">{fmt(legend.open)}</span></span>
              <span className="dim">H <span className="up">{fmt(legend.high)}</span></span>
              <span className="dim">L <span className="down">{fmt(legend.low)}</span></span>
              <span className="dim">C <span className={legend.close >= legend.open ? "up" : "down"}>{fmt(legend.close)}</span></span>
              <span className="dim">Vol <span className="text-[var(--text)]">{fmtBig(legend.volume)}</span></span>
            </div>
            {indicatorRows.length > 0 && (
              <div className="flex gap-3 flex-wrap">
                {indicatorRows.map((r) => (
                  <span key={r.label} className="dim">
                    {r.label} <span style={{ color: r.color }}>{r.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
