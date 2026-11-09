"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, pctClass, type Quote } from "../../lib/api";
import { useTerminal, type WidgetInstance } from "../../store/terminal";
import ChartWidget from "../widgets/ChartWidget";
import NewsWidget from "../widgets/NewsWidget";
import QuoteWidget from "../widgets/QuoteWidget";
import WatchlistWidget from "../widgets/WatchlistWidget";
import { PageHeader, Surface } from "../shell/Surface";
import MarketPulse from "./MarketPulse";
import ScannerPreview from "./ScannerPreview";

type MarketTab = "setups" | "news" | "stats";

const chartWidget: WidgetInstance = { id: "markets-chart", type: "chart", linked: true };
const quoteWidget: WidgetInstance = { id: "markets-quote", type: "quote", linked: true };
const newsWidget: WidgetInstance = { id: "markets-news", type: "news", linked: true };

const TABS: Array<{ id: MarketTab; label: string }> = [
  { id: "setups", label: "Setups" },
  { id: "news", label: "News" },
  { id: "stats", label: "Stats" },
];

export default function MarketsPage() {
  const activeSymbol = useTerminal((state) => state.activeSymbol);
  const watchlist = useTerminal((state) => state.watchlist);
  const [tab, setTab] = useState<MarketTab>("setups");

  const { data: quote } = useQuery({
    queryKey: ["quote", activeSymbol],
    queryFn: async () =>
      (await apiGet<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(activeSymbol)}`))[0],
    refetchInterval: 15_000,
    retry: 0,
  });

  return (
    <div className="edge-page edge-markets">
      <PageHeader
        title="Markets"
        lead="The market at a glance, the active chart and the setups worth a look."
        actions={
          <Link href="/scanner" className="edge-btn">
            Scanner
          </Link>
        }
      />

      <MarketPulse />

      <div className="edge-market-layout">
        <Surface
          title="Watchlist"
          sub={`${watchlist.length} symbols`}
          flush
          className="edge-market-watchlist"
        >
          <div className="edge-scroll">
            <WatchlistWidget />
          </div>
        </Surface>

        <section className="edge-market-focus">
          <header className="edge-symbol-hero">
            <div>
              <div className="edge-symbol-hero-top">
                <h2>{activeSymbol}</h2>
                <span className="edge-symbol-hero-name">
                  {quote?.name ?? "Live market quote"}
                  {quote?.exchange ? `, ${quote.exchange}` : ""}
                </span>
              </div>
              <div className="edge-symbol-hero-price-row">
                <span className="edge-symbol-hero-price">{fmt(quote?.price)}</span>
                <span className={`edge-symbol-hero-change ${pctClass(quote?.changePercent)}`}>
                  {quote?.change !== null && quote?.change !== undefined
                    ? `${quote.change >= 0 ? "+" : ""}${fmt(quote.change)}`
                    : "-"}
                  {quote?.changePercent !== null && quote?.changePercent !== undefined
                    ? ` (${fmt(quote.changePercent)}%)`
                    : ""}
                </span>
              </div>
            </div>
            <Link
              href={`/symbol/${encodeURIComponent(activeSymbol)}`}
              className="edge-btn edge-btn--primary"
            >
              Trade {activeSymbol}
            </Link>
          </header>

          <Surface flush className="edge-market-chart">
            <div className="edge-chart edge-chart--market">
              <ChartWidget widget={chartWidget} compact />
            </div>
          </Surface>

          <section className="edge-surface edge-market-info">
            <div className="edge-market-tabs" role="tablist" aria-label="Market information">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  className="edge-market-tab"
                  aria-selected={tab === item.id}
                  aria-controls={`market-${item.id}`}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div
              id={`market-${tab}`}
              role="tabpanel"
              className="edge-market-tab-body"
              aria-label={TABS.find((item) => item.id === tab)?.label}
            >
              {tab === "setups" ? (
                <ScannerPreview />
              ) : tab === "news" ? (
                <NewsWidget widget={newsWidget} />
              ) : (
                <QuoteWidget widget={quoteWidget} />
              )}
            </div>
          </section>
        </section>
      </div>
    </div>
  );
}
