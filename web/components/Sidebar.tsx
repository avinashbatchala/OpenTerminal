"use client";

import { useTerminal, type WidgetType } from "../store/terminal";

const ITEMS: Array<{ type: WidgetType; label: string; key: string }> = [
  { type: "chart", label: "CHART", key: "⌥1" },
  { type: "quote", label: "QUOTE", key: "⌥2" },
  { type: "news", label: "NEWS", key: "⌥3" },
  { type: "screener", label: "SCREENER", key: "⌥4" },
  { type: "opportunities", label: "OPPORTUNITIES", key: "⌥9" },
  { type: "paper", label: "PAPER", key: "⌥0" },
  { type: "heatmap", label: "HEATMAP", key: "⌥5" },
  { type: "crypto", label: "CRYPTO", key: "⌥6" },
  { type: "options", label: "OPTIONS", key: "⌥7" },
  { type: "portfolio", label: "PORTFOLIO", key: "⌥8" },
  { type: "watchlist", label: "WATCHLIST", key: "" },
  { type: "macro", label: "MACRO", key: "" },
  { type: "calendar", label: "CALENDAR", key: "" },
  { type: "insider", label: "INSIDER", key: "" },
  { type: "tv", label: "LIVE TV", key: "" },
  { type: "recap", label: "MARKET RECAP", key: "" },
];

export default function Sidebar({
  mobileOpen = false,
  onClose,
}: {
  mobileOpen?: boolean;
  onClose?: () => void;
} = {}) {
  const addWidget = useTerminal((s) => s.addWidget);
  const resetWorkspace = useTerminal((s) => s.resetWorkspace);

  return (
    <nav
      className={`sidebar w-32 bg-[var(--panel)] border-r border-[var(--border)] flex flex-col shrink-0 ${
        mobileOpen ? "is-mobile-open" : ""
      }`}
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-2 py-1">
        <span className="dim text-[10px] uppercase tracking-wider">Add widget</span>
        {onClose && (
          <button
            type="button"
            className="sidebar-close"
            onClick={onClose}
            aria-label="Close widget panel"
          >
            ✕
          </button>
        )}
      </div>
      {ITEMS.map((item) => (
        <button
          key={item.type}
          onClick={() => addWidget(item.type)}
          className="text-left px-2 py-1.5 text-[11px] hover:bg-[#2c2c2e] hover:text-[var(--amber)] flex justify-between"
        >
          <span>{item.label}</span>
          <span className="dim text-[9px]">{item.key}</span>
        </button>
      ))}
      <div className="mt-auto border-t border-[var(--border)]">
        <button
          onClick={resetWorkspace}
          className="w-full text-left px-2 py-1.5 text-[11px] dim hover:text-[var(--down)]"
        >
          RESET LAYOUT
        </button>
      </div>
    </nav>
  );
}
