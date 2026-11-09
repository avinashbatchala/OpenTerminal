"use client";

import { useState } from "react";
import { useTerminal, type WidgetInstance } from "../../store/terminal";
import CalendarWidget from "../widgets/CalendarWidget";
import CryptoWidget from "../widgets/CryptoWidget";
import HeatmapWidget from "../widgets/HeatmapWidget";
import InsiderWidget from "../widgets/InsiderWidget";
import MacroWidget from "../widgets/MacroWidget";
import NewsWidget from "../widgets/NewsWidget";
import RecapWidget from "../widgets/RecapWidget";
import ScreenerWidget from "../widgets/ScreenerWidget";
import TvWidget from "../widgets/TvWidget";
import { PageHeader, Surface } from "../shell/Surface";

type ResearchTab =
  | "news"
  | "macro"
  | "calendar"
  | "insider"
  | "screener"
  | "heatmap"
  | "crypto"
  | "recap"
  | "tv";

const TABS: Array<{ id: ResearchTab; label: string }> = [
  { id: "news", label: "News" },
  { id: "macro", label: "Macro" },
  { id: "calendar", label: "Calendar" },
  { id: "insider", label: "Insider" },
  { id: "screener", label: "Screener" },
  { id: "heatmap", label: "Heatmap" },
  { id: "crypto", label: "Crypto" },
  { id: "recap", label: "Recap" },
  { id: "tv", label: "Live TV" },
];

export default function ResearchPage() {
  const activeSymbol = useTerminal((state) => state.activeSymbol);
  const [tab, setTab] = useState<ResearchTab>("news");

  const symbolWidget: WidgetInstance = {
    id: "research-symbol",
    type: "news",
    linked: true,
  };

  const content = () => {
    switch (tab) {
      case "news":
        return <NewsWidget widget={symbolWidget} />;
      case "macro":
        return <MacroWidget />;
      case "calendar":
        return <CalendarWidget />;
      case "insider":
        return <InsiderWidget widget={symbolWidget} />;
      case "screener":
        return <ScreenerWidget />;
      case "heatmap":
        return <HeatmapWidget />;
      case "crypto":
        return <CryptoWidget />;
      case "recap":
        return <RecapWidget />;
      case "tv":
        return <TvWidget />;
    }
  };

  return (
    <div className="edge-page">
      <PageHeader
        title="Research"
        lead={`News, macro context and market tools around ${activeSymbol}.`}
      />

      <div className="edge-research-tabs">
        <div className="edge-tabs" role="tablist" aria-label="Research section">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              className="edge-tab"
              aria-selected={tab === item.id}
              aria-controls={`research-${item.id}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <Surface flush>
        <div
          id={`research-${tab}`}
          role="tabpanel"
          className="edge-research-body"
          aria-label={TABS.find((item) => item.id === tab)?.label}
        >
          {content()}
        </div>
      </Surface>
    </div>
  );
}
