"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, pctClass, type Quote } from "../../lib/api";
import { useTerminal, type WidgetInstance } from "../../store/terminal";
import ChartWidget from "../widgets/ChartWidget";
import InsiderWidget from "../widgets/InsiderWidget";
import NewsWidget from "../widgets/NewsWidget";
import OptionsWidget from "../widgets/OptionsWidget";
import QuoteWidget from "../widgets/QuoteWidget";
import { Surface } from "../shell/Surface";
import SymbolPosition from "./SymbolPosition";
import SymbolSetups from "./SymbolSetups";

type DetailTab = "options" | "news" | "insider";

const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "options", label: "Options" },
  { id: "news", label: "News" },
  { id: "insider", label: "Insider" },
];

export default function SymbolPage() {
  const params = useParams<{ symbol?: string | string[] }>();
  const raw = params?.symbol;
  const symbol = (Array.isArray(raw) ? raw[0] : raw ?? "").toUpperCase();
  const setActiveSymbol = useTerminal((state) => state.setActiveSymbol);
  const [tab, setTab] = useState<DetailTab>("options");

  useEffect(() => {
    if (symbol) setActiveSymbol(symbol);
  }, [setActiveSymbol, symbol]);

  const { data: quote } = useQuery({
    queryKey: ["quote", symbol],
    queryFn: async () => (await apiGet<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(symbol)}`))[0],
    enabled: Boolean(symbol),
    refetchInterval: 15_000,
    retry: 0,
  });

  const chartWidget = useMemo<WidgetInstance>(
    () => ({ id: `symbol-chart-${symbol}`, type: "chart", linked: false, symbol }),
    [symbol]
  );
  const quoteWidget = useMemo<WidgetInstance>(
    () => ({ id: `symbol-quote-${symbol}`, type: "quote", linked: false, symbol }),
    [symbol]
  );
  const newsWidget = useMemo<WidgetInstance>(
    () => ({ id: `symbol-news-${symbol}`, type: "news", linked: false, symbol }),
    [symbol]
  );
  const insiderWidget = useMemo<WidgetInstance>(
    () => ({ id: `symbol-insider-${symbol}`, type: "insider", linked: false, symbol }),
    [symbol]
  );
  const optionsWidget = useMemo<WidgetInstance>(
    () => ({ id: `symbol-options-${symbol}`, type: "options", linked: false, symbol }),
    [symbol]
  );
  const activeWidget =
    tab === "news" ? newsWidget : tab === "insider" ? insiderWidget : optionsWidget;

  if (!symbol) {
    return (
      <div className="edge-page">
        <p className="edge-muted">No symbol selected.</p>
      </div>
    );
  }

  return (
    <div className="edge-page">
      <header className="edge-page-head edge-symbol-head">
        <div className="edge-symbol-head-main">
          <div className="edge-symbol-title-row">
            <h1 className="edge-page-title">{symbol}</h1>
            <span className="edge-symbol-price">{fmt(quote?.price ?? null)}</span>
            <span className={`edge-symbol-change ${pctClass(quote?.changePercent)}`}>
              {quote?.change !== null && quote?.change !== undefined
                ? `${quote.change >= 0 ? "+" : ""}${fmt(quote.change)}`
                : "-"}
              {quote?.changePercent !== null && quote?.changePercent !== undefined
                ? ` (${fmt(quote.changePercent)}%)`
                : ""}
            </span>
          </div>
          <p className="edge-page-lead">
            {quote?.name ?? "Live market quote"}
            {quote?.source ? <span className="edge-muted edge-symbol-source">{quote.source}</span> : null}
          </p>
        </div>
        <div className="edge-page-actions">
          <Link href="/scanner" className="edge-btn">
            Scanner
          </Link>
          <a href="#symbol-setups" className="edge-btn edge-btn--primary">
            Paper trade
          </a>
        </div>
      </header>

      <div className="edge-grid edge-grid--symbol">
        <div className="edge-symbol-main">
          <Surface
            title="Chart"
            sub={symbol}
            action={
              <Link href="/scanner" className="edge-btn edge-btn--quiet edge-btn--sm">
                Setups
              </Link>
            }
            flush
          >
            <div className="edge-chart">
              <ChartWidget widget={chartWidget} />
            </div>
          </Surface>

          <div className="edge-symbol-tabs">
            <div className="edge-tabs" role="tablist" aria-label="Symbol detail">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  className="edge-tab"
                  aria-selected={tab === item.id}
                  aria-controls={`symbol-${item.id}`}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <Surface title={TABS.find((item) => item.id === tab)?.label ?? ""} flush>
            <div
              id={`symbol-${tab}`}
              role="tabpanel"
              className="edge-symbol-tab-body"
              aria-label={TABS.find((item) => item.id === tab)?.label}
            >
              {tab === "options" ? (
                <OptionsWidget widget={activeWidget} />
              ) : tab === "news" ? (
                <NewsWidget widget={activeWidget} />
              ) : (
                <InsiderWidget widget={activeWidget} />
              )}
            </div>
          </Surface>
        </div>

        <aside className="edge-symbol-rail">
          <Surface title="Quote" flush>
            <div className="edge-quote-scroll">
              <QuoteWidget widget={quoteWidget} />
            </div>
          </Surface>
          <SymbolPosition symbol={symbol} />
          <SymbolSetups symbol={symbol} />
        </aside>
      </div>
    </div>
  );
}
