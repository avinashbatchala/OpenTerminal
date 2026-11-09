"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api";
import type { ExecutionStatus } from "../../lib/paper";
import { formatUsd } from "../../lib/scanner";
import { useTerminal } from "../../store/terminal";
import { SearchIcon } from "./icons";
import Tag from "../ui/Tag";

type PlatformStatus = {
  ok: boolean;
  dataSource?: "schwab" | "public";
  schwab?: { configured: boolean; streaming: string };
  ai: boolean;
};

function marketState(date: Date): { label: string; open: boolean } {
  const ny = new Date(date.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = ny.getDay();
  const minutes = ny.getHours() * 60 + ny.getMinutes();
  const open = day >= 1 && day <= 5 && minutes >= 570 && minutes < 960;
  return { label: open ? "Market open" : "Market closed", open };
}

export default function MarketBar() {
  const setCommandOpen = useTerminal((state) => state.setCommandOpen);
  const activeSymbol = useTerminal((state) => state.activeSymbol);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const { data: status } = useQuery({
    queryKey: ["status"],
    queryFn: () => apiGet<PlatformStatus>("/api/status"),
    refetchInterval: 30_000,
    retry: 0,
  });
  const { data: execution } = useQuery({
    queryKey: ["execution", "status"],
    queryFn: () => apiGet<ExecutionStatus>("/api/execution/status", { timeoutMs: 8_000 }),
    refetchInterval: 10_000,
    retry: 0,
  });

  const market = now ? marketState(now) : { label: "Market", open: false };
  const equity = execution?.equity?.equityUsd ?? execution?.config?.startingCashUsd ?? null;
  const openTrades = execution?.counts.open ?? 0;
  const source = status?.dataSource === "schwab" ? "Schwab" : "Public data";

  return (
    <header className="edge-topbar">
      <Link href="/" className="edge-topbar-brand" aria-label="OpenEdge home">
        <span className="edge-brand-mark" aria-hidden="true">
          OE
        </span>
        <span>OpenEdge</span>
      </Link>

      <span className="edge-market-state" data-open={market.open}>
        <span className="edge-market-dot" aria-hidden="true" />
        {market.label}
      </span>

      <button
        type="button"
        className="edge-search"
        onClick={() => setCommandOpen(true)}
        aria-label="Search symbols"
      >
        <SearchIcon />
        <span className="edge-search-symbol">{activeSymbol}</span>
        <span className="edge-search-copy edge-muted">Search symbol</span>
        <kbd>⌘K</kbd>
      </button>

      <Tag title={`Data source: ${source}`}>{source}</Tag>

      <div className="edge-account">
        <span className="edge-account-stat">
          <span className="edge-account-label">Paper equity</span>
          <span className="edge-account-figure">{formatUsd(equity)}</span>
        </span>
        <span className="edge-account-stat">
          <span className="edge-account-label">Open</span>
          <span className="edge-account-figure">{openTrades}</span>
        </span>
      </div>
    </header>
  );
}
