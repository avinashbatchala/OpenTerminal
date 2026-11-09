"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiGet } from "../lib/api";
import { useTerminal } from "../store/terminal";

type SearchResult = { symbol: string; name: string; exchange: string; type: string };

const PAGES = [
  { label: "Markets", href: "/", description: "Watchlist, chart and setups" },
  { label: "Scanner", href: "/scanner", description: "Opportunity queue" },
  { label: "Portfolio", href: "/portfolio", description: "Paper positions and fills" },
  { label: "Research", href: "/research", description: "News, macro and market tools" },
  { label: "Settings", href: "/settings", description: "Broker and assistant" },
];

export default function CommandPalette() {
  const router = useRouter();
  const open = useTerminal((state) => state.commandOpen);
  const setOpen = useTerminal((state) => state.setCommandOpen);
  const setActiveSymbol = useTerminal((state) => state.setActiveSymbol);
  const addToWatchlist = useTerminal((state) => state.addToWatchlist);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  const { data: results = [] } = useQuery({
    queryKey: ["search", query],
    queryFn: () => apiGet<SearchResult[]>(`/api/search?q=${encodeURIComponent(query)}`),
    enabled: open && query.trim().length > 0,
    staleTime: 300_000,
  });

  useEffect(() => {
    if (open) {
      if (!wasOpen.current) restoreFocusRef.current = document.activeElement as HTMLElement | null;
      wasOpen.current = true;
      setQuery("");
      setSelected(0);
      const timer = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(timer);
    }

    if (wasOpen.current) {
      const target = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (target?.isConnected) requestAnimationFrame(() => target.focus());
    }
    wasOpen.current = false;
    return undefined;
  }, [open]);

  useEffect(() => setSelected(0), [results.length, query]);

  if (!open) return null;

  const searching = query.trim().length > 0;
  const items = searching ? results.map((result) => ({ kind: "symbol" as const, result })) : PAGES.map((page) => ({ kind: "page" as const, page }));

  const pickSymbol = (result: SearchResult, watch = false) => {
    setActiveSymbol(result.symbol);
    if (watch) addToWatchlist(result.symbol);
    setOpen(false);
    router.push(`/symbol/${encodeURIComponent(result.symbol)}`);
  };

  const pickPage = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const pick = (index: number, watch = false) => {
    const item = items[index];
    if (!item) return;
    if (item.kind === "symbol") pickSymbol(item.result, watch);
    else pickPage(item.page.href);
  };

  return (
    <div
      className="edge-command-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="edge-command" role="dialog" aria-modal="true" aria-label="Search and navigation">
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelected((current) => Math.min(current + 1, items.length - 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((current) => Math.max(current - 1, 0));
            }
            if (event.key === "Enter") {
              event.preventDefault();
              pick(selected, event.shiftKey);
            }
          }}
          placeholder="Search symbols or jump to a page"
          aria-label="Search symbols or jump to a page"
          className="edge-command-input"
          autoComplete="off"
          spellCheck={false}
        />

        <div className="edge-command-results">
          {searching ? (
            results.length === 0 ? (
              <p className="edge-command-empty">No results for “{query}”.</p>
            ) : (
              results.map((result, index) => (
                <button
                  key={result.symbol}
                  type="button"
                  className="edge-command-row"
                  data-active={index === selected}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => pickSymbol(result, false)}
                >
                  <span className="edge-command-symbol">{result.symbol}</span>
                  <span className="edge-command-name">{result.name}</span>
                  <span className="edge-command-meta">{result.exchange}</span>
                  <span className="edge-command-meta">{result.type}</span>
                </button>
              ))
            )
          ) : (
            PAGES.map((page, index) => (
              <button
                key={page.href}
                type="button"
                className="edge-command-row"
                data-active={index === selected}
                onMouseEnter={() => setSelected(index)}
                onClick={() => pickPage(page.href)}
              >
                <span className="edge-command-symbol">{page.label}</span>
                <span className="edge-command-name">{page.description}</span>
                <span className="edge-command-meta">{page.href}</span>
              </button>
            ))
          )}
        </div>

        <div className="edge-command-foot">
          <span>Enter opens</span>
          <span>Shift + Enter opens and watches</span>
          <span>Esc closes</span>
        </div>
      </div>
    </div>
  );
}
