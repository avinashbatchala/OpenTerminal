"use client";

import Link from "next/link";
import { useTerminal, type WidgetInstance } from "../../store/terminal";
import ChartWidget from "../widgets/ChartWidget";
import NewsWidget from "../widgets/NewsWidget";
import QuoteWidget from "../widgets/QuoteWidget";
import WatchlistWidget from "../widgets/WatchlistWidget";
import { PageHeader, Surface } from "../shell/Surface";
import ScannerPreview from "./ScannerPreview";

const chartWidget: WidgetInstance = { id: "markets-chart", type: "chart", linked: true };
const quoteWidget: WidgetInstance = { id: "markets-quote", type: "quote", linked: true };
const newsWidget: WidgetInstance = { id: "markets-news", type: "news", linked: true };

export default function MarketsPage() {
  const activeSymbol = useTerminal((state) => state.activeSymbol);
  const watchlist = useTerminal((state) => state.watchlist);

  return (
    <div className="edge-page">
      <PageHeader
        title="Markets"
        lead="Your watchlist, the active chart and the setups that need attention."
        actions={
          <Link href={`/symbol/${encodeURIComponent(activeSymbol)}`} className="edge-btn edge-btn--primary">
            Open {activeSymbol}
          </Link>
        }
      />

      <div className="edge-grid edge-grid--markets">
        <Surface
          title="Watchlist"
          sub={`${watchlist.length} symbols`}
          flush
          className="edge-col-watchlist"
        >
          <div className="edge-scroll">
            <WatchlistWidget />
          </div>
        </Surface>

        <Surface
          title={activeSymbol}
          sub="Chart"
          action={
            <Link
              href={`/symbol/${encodeURIComponent(activeSymbol)}`}
              className="edge-btn edge-btn--quiet edge-btn--sm"
            >
              Trade view
            </Link>
          }
          flush
          className="edge-col-chart"
        >
          <div className="edge-chart">
            <ChartWidget widget={chartWidget} />
          </div>
        </Surface>

        <div className="edge-col-side">
          <Surface title="Quote" flush>
            <div className="edge-quote-scroll">
              <QuoteWidget widget={quoteWidget} />
            </div>
          </Surface>
        </div>
      </div>

      <div className="edge-grid edge-grid--half edge-grid--gap-top">
        <ScannerPreview />
        <Surface title="News" sub={activeSymbol} flush>
          <div className="edge-news-scroll">
            <NewsWidget widget={newsWidget} />
          </div>
        </Surface>
      </div>
    </div>
  );
}
