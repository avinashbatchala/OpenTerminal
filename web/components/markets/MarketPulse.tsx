"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, pctClass, type Quote } from "../../lib/api";
import { mergeLiveQuote, useLiveQuotes } from "../../lib/live";
import { symbolsParam } from "../../lib/symbol";
import { useTerminal } from "../../store/terminal";

const INDICES = [
  { symbol: "SPY", label: "S&P 500 ETF" },
  { symbol: "QQQ", label: "Nasdaq 100 ETF" },
  { symbol: "DIA", label: "Dow ETF" },
  { symbol: "IWM", label: "Russell 2000 ETF" },
];

const SYMBOLS = INDICES.map((index) => index.symbol);

export default function MarketPulse() {
  const setActiveSymbol = useTerminal((state) => state.setActiveSymbol);
  const { quotes: liveQuotes } = useLiveQuotes(SYMBOLS);
  const { data = [] } = useQuery({
    queryKey: ["market-pulse", SYMBOLS.join(",")],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(SYMBOLS)}`),
    refetchInterval: 15_000,
    retry: 0,
  });

  const bySymbol = new Map(data.map((quote) => [quote.symbol, quote]));

  return (
    <div className="edge-pulse" role="group" aria-label="Market indices">
      {INDICES.map((index) => {
        const rest = bySymbol.get(index.symbol);
        const quote = rest ? mergeLiveQuote(rest, liveQuotes[index.symbol]) : liveQuotes[index.symbol];
        const change = quote?.changePercent ?? null;
        return (
          <button
            key={index.symbol}
            type="button"
            className="edge-pulse-item"
            onClick={() => setActiveSymbol(index.symbol)}
            aria-label={`${index.label} ${fmt(quote?.price)}${
              change === null ? "" : `, ${change >= 0 ? "up" : "down"} ${fmt(Math.abs(change))} percent`
            }`}
          >
            <span className="edge-pulse-label">{index.label}</span>
            <span className="edge-pulse-figure">{fmt(quote?.price)}</span>
            <span className={`edge-pulse-change ${pctClass(change)}`}>
              {change === null ? "-" : `${change >= 0 ? "+" : ""}${fmt(change)}%`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
