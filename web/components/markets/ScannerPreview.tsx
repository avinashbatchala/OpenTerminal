"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api";
import { STRATEGY_LABELS, formatUsd, type Opportunity } from "../../lib/scanner";
import { Surface } from "../shell/Surface";

function stateChip(state: Opportunity["state"]) {
  if (state === "entry_ready") return "edge-chip edge-chip--accent";
  return "edge-chip";
}

export default function ScannerPreview() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["scanner", "opportunities", "preview"],
    queryFn: () =>
      apiGet<Opportunity[]>("/api/scanner/opportunities?history=true&limit=200", {
        timeoutMs: 12_000,
      }),
    refetchInterval: 30_000,
    retry: 0,
  });

  const rows = data
    .filter(
      (opportunity) =>
        !opportunity.archived &&
        !opportunity.dismissed &&
        (opportunity.state === "entry_ready" || opportunity.state === "watching")
    )
    .sort((a, b) => {
      const rank = (opportunity: Opportunity) =>
        opportunity.state === "entry_ready" ? 0 : 1;
      return rank(a) - rank(b) || Date.parse(a.deadline) - Date.parse(b.deadline);
    })
    .slice(0, 5);

  return (
    <Surface
      title="Setups"
      sub={isLoading ? "Loading" : `${rows.length} active`}
      action={
        <Link href="/scanner" className="edge-btn edge-btn--quiet edge-btn--sm">
          Open scanner
        </Link>
      }
      flush
    >
      {rows.length === 0 ? (
        <div className="edge-empty">
          No active setups. The scanner looks for new entries during the US session.
        </div>
      ) : (
        <div>
          {rows.map((opportunity) => {
            const levels = opportunity.conditions.levels;
            return (
              <Link
                key={opportunity.id}
                href={`/symbol/${opportunity.symbol}`}
                className="edge-setup-row"
              >
                <span className="edge-setup-main">
                  <span className="edge-setup-top">
                    <span className="edge-setup-symbol">{opportunity.symbol}</span>
                    <span className={stateChip(opportunity.state)}>
                      {opportunity.state === "entry_ready" ? "Entry ready" : "Watching"}
                    </span>
                    <span
                      className={
                        opportunity.direction === "bullish"
                          ? "up"
                          : opportunity.direction === "bearish"
                            ? "down"
                            : "edge-muted"
                      }
                    >
                      {opportunity.direction === "bullish"
                        ? "Bullish"
                        : opportunity.direction === "bearish"
                          ? "Bearish"
                          : "Neutral"}
                    </span>
                  </span>
                  <span className="edge-setup-meta">
                    {STRATEGY_LABELS[opportunity.strategy as keyof typeof STRATEGY_LABELS] ??
                      opportunity.strategy}
                    <span className="edge-muted">{opportunity.horizon}</span>
                    <span className="edge-muted">
                      Entry {formatUsd(levels.entry)}
                    </span>
                  </span>
                </span>
                <span className="edge-setup-side">
                  <span className="edge-muted">Target</span>
                  <span className="edge-num">{formatUsd(levels.target)}</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </Surface>
  );
}
