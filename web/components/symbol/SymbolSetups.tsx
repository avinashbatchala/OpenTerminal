"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../../lib/api";
import { STRATEGY_LABELS, formatUsd, type Opportunity } from "../../lib/scanner";
import { Surface } from "../shell/Surface";

function isActive(opportunity: Opportunity): boolean {
  return (
    !opportunity.archived &&
    !opportunity.dismissed &&
    (opportunity.state === "watching" || opportunity.state === "entry_ready")
  );
}

export default function SymbolSetups({ symbol }: { symbol: string }) {
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ["scanner", "opportunities", "symbol", symbol],
    queryFn: () =>
      apiGet<Opportunity[]>("/api/scanner/opportunities?history=true&limit=200", {
        timeoutMs: 12_000,
      }),
    refetchInterval: 30_000,
    retry: 0,
  });

  const rows = data
    .filter((opportunity) => opportunity.symbol === symbol && isActive(opportunity))
    .sort((a, b) => {
      const rank = (opportunity: Opportunity) =>
        opportunity.state === "entry_ready" ? 0 : 1;
      return rank(a) - rank(b) || Date.parse(a.deadline) - Date.parse(b.deadline);
    })
    .slice(0, 4);

  const enter = useMutation({
    mutationFn: (opportunityId: string) =>
      apiPost("/api/execution/enter", { opportunityId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["execution"] });
      await queryClient.invalidateQueries({ queryKey: ["scanner"] });
    },
  });

  return (
    <div id="symbol-setups">
      <Surface
        title="Setups"
        sub={symbol}
        action={
          <Link href="/scanner" className="edge-btn edge-btn--quiet edge-btn--sm">
            Scanner
          </Link>
        }
      >
        {isLoading ? (
          <p className="edge-muted text-[13px]">Loading setups…</p>
        ) : rows.length === 0 ? (
          <p className="edge-muted text-[13px]">
            No active setup for {symbol}. The scanner will surface one when the level is verified.
          </p>
        ) : (
          <div className="edge-setup-list">
            {rows.map((opportunity) => {
              const levels = opportunity.conditions.levels;
              const ready = opportunity.state === "entry_ready";
              return (
                <div key={opportunity.id} className="edge-symbol-setup">
                  <div className="edge-symbol-setup-head">
                    <span className="edge-symbol-setup-name">
                      {STRATEGY_LABELS[opportunity.strategy as keyof typeof STRATEGY_LABELS] ??
                        opportunity.strategy}
                    </span>
                    <span className={ready ? "edge-chip edge-chip--accent" : "edge-chip"}>
                      {ready ? "Entry ready" : "Watching"}
                    </span>
                  </div>
                  <dl className="edge-symbol-setup-facts">
                    <div>
                      <dt>Entry</dt>
                      <dd>{formatUsd(levels.entry)}</dd>
                    </div>
                    <div>
                      <dt>Target</dt>
                      <dd>{formatUsd(levels.target)}</dd>
                    </div>
                    <div>
                      <dt>Invalidation</dt>
                      <dd>{formatUsd(levels.invalidation)}</dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    className="edge-btn edge-btn--sm w-full"
                    disabled={!ready || enter.isPending}
                    title={ready ? "Enter a simulated paper trade" : "Waits for the entry level"}
                    onClick={() => enter.mutate(opportunity.id)}
                  >
                    {enter.isPending && enter.variables === opportunity.id
                      ? "Entering…"
                      : ready
                        ? "Paper trade"
                        : "Watching"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {enter.error ? (
          <p className="down mt-2 text-[12px]">{(enter.error as Error).message}</p>
        ) : null}
      </Surface>
    </div>
  );
}
