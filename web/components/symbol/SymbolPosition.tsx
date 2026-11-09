"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../../lib/api";
import { useLiveExecution } from "../../lib/liveExecution";
import {
  entryPremiumUsd,
  unrealizedUsd,
  type ExecutionStatus,
} from "../../lib/paper";
import { formatUsd } from "../../lib/scanner";
import { Surface } from "../shell/Surface";

function Pnl({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <span className="edge-muted">-</span>;
  return (
    <span className={value >= 0 ? "up" : "down"}>
      {value >= 0 ? "+" : ""}
      {formatUsd(value)}
    </span>
  );
}

export default function SymbolPosition({ symbol }: { symbol: string }) {
  const queryClient = useQueryClient();
  const live = useLiveExecution();
  const { data: status } = useQuery({
    queryKey: ["execution", "status"],
    queryFn: () => apiGet<ExecutionStatus>("/api/execution/status", { timeoutMs: 8_000 }),
    refetchInterval: 10_000,
    retry: 0,
  });

  const trade =
    status?.openTrades.find(
      (candidate) =>
        candidate.symbol === symbol && candidate.status !== "closed" && candidate.status !== "rejected"
    ) ?? null;
  const mark = trade
    ? live.marks[trade.id] ?? status?.latestMarks?.[trade.id] ?? null
    : null;

  const close = useMutation({
    mutationFn: (tradeId: string) =>
      apiPost(`/api/execution/trades/${encodeURIComponent(tradeId)}/close`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["execution"] }),
  });

  return (
    <Surface
      title="Position"
      sub={symbol}
      action={
        <Link href="/portfolio" className="edge-btn edge-btn--quiet edge-btn--sm">
          Portfolio
        </Link>
      }
    >
      {!trade ? (
        <p className="edge-muted text-[13px]">
          No open paper position. Use a setup below to enter one.
        </p>
      ) : (
        <div className="edge-position">
          <div className="edge-position-top">
            <span className="edge-position-strategy">{trade.strategy.replaceAll("_", " ")}</span>
            <span className={trade.status === "open" ? "edge-chip edge-chip--accent" : "edge-chip"}>
              {trade.status.replaceAll("_", " ")}
            </span>
          </div>
          <dl className="edge-position-facts">
            <div>
              <dt>Entry</dt>
              <dd>
                {entryPremiumUsd(trade) === null
                  ? "-"
                  : formatUsd(entryPremiumUsd(trade) ?? 0)}
              </dd>
            </div>
            <div>
              <dt>Mark</dt>
              <dd>{mark ? formatUsd(mark.liquidationValueUsd) : "-"}</dd>
            </div>
            <div>
              <dt>Unrealized</dt>
              <dd>
                <Pnl value={unrealizedUsd(trade, mark)} />
              </dd>
            </div>
          </dl>
          {close.error ? (
            <p className="down text-[12px]">{(close.error as Error).message}</p>
          ) : null}
          <button
            type="button"
            className="edge-btn edge-btn--sm w-full"
            disabled={close.isPending || trade.status !== "open"}
            onClick={() => close.mutate(trade.id)}
          >
            {close.isPending ? "Closing…" : "Close paper trade"}
          </button>
        </div>
      )}
    </Surface>
  );
}
