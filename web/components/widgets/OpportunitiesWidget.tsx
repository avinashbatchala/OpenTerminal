"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "../../lib/api";
import { deadlineStatus, planLine, tradeAction } from "../../lib/opportunityInsight";
import type { ExecutionTrade } from "../../lib/paper";
import {
  STRATEGY_LABELS,
  emptyState,
  formatDateTime,
  formatUsd,
  type Horizon,
  type Opportunity,
  type ScannerNotification,
  type ScannerStatus,
} from "../../lib/scanner";
import { HealthBadge, StateBadge } from "../scanner/StatusBadges";
import OpportunityDetail from "../scanner/OpportunityDetail";
import ScannerOverlay from "../scanner/ScannerOverlay";
import ScannerSettings from "../scanner/ScannerSettings";

const ACTIVE_STATES = new Set(["watching", "entry_ready"]);
const HORIZONS: Horizon[] = ["intraday", "swing"];
const STATE_RANK: Record<string, number> = {
  entry_ready: 0,
  watching: 1,
  missed: 2,
  invalidated: 3,
  expired: 4,
};

type View = "active" | "all";

function directionClass(direction: string) {
  return direction === "bullish" ? "up" : direction === "bearish" ? "down" : "dim";
}

export default function OpportunitiesWidget() {
  const queryClient = useQueryClient();
  const [horizon, setHorizon] = useState<Horizon>("intraday");
  const [view, setView] = useState<View>("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const statusQuery = useQuery({
    queryKey: ["scanner", "status"],
    queryFn: () => apiGet<ScannerStatus>("/api/scanner/status", { timeoutMs: 8_000 }),
    refetchInterval: 30_000,
    retry: 0,
  });
  const status = statusQuery.data;

  const opportunitiesQuery = useQuery({
    queryKey: ["scanner", "opportunities", horizon],
    queryFn: () =>
      apiGet<Opportunity[]>(`/api/scanner/opportunities?horizon=${horizon}&history=true&limit=200`, {
        timeoutMs: 12_000,
      }),
    refetchInterval: 30_000,
    retry: 0,
  });

  const paperTradesQuery = useQuery({
    queryKey: ["execution", "trades"],
    queryFn: () => apiGet<ExecutionTrade[]>("/api/execution/trades?limit=200", { timeoutMs: 8_000 }),
    refetchInterval: 30_000,
    retry: 0,
  });

  const notificationsQuery = useQuery({
    queryKey: ["scanner", "notifications", "unread"],
    queryFn: () =>
      apiGet<ScannerNotification[]>("/api/scanner/notifications?unread=true", { timeoutMs: 8_000 }),
    refetchInterval: 30_000,
    retry: 0,
  });

  const pin = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      apiPost(`/api/scanner/opportunities/${encodeURIComponent(id)}/pin`, { pinned }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scanner"] }),
  });
  const dismiss = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/api/scanner/opportunities/${encodeURIComponent(id)}/dismiss`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scanner"] }),
  });

  const [paperError, setPaperError] = useState<string | null>(null);
  const paperEnter = useMutation({
    mutationFn: (opportunityId: string) =>
      apiPost("/api/execution/enter", { opportunityId }),
    onSuccess: () => {
      setPaperError(null);
      return queryClient.invalidateQueries({ queryKey: ["execution"] });
    },
    onError: (error: Error) => setPaperError(error.message),
  });
  const paperClose = useMutation({
    mutationFn: (tradeId: string) =>
      apiPost(`/api/execution/trades/${encodeURIComponent(tradeId)}/close`, {}),
    onSuccess: () => {
      setPaperError(null);
      return queryClient.invalidateQueries({ queryKey: ["execution"] });
    },
    onError: (error: Error) => setPaperError(error.message),
  });

  const paperByOpportunity = new Map<string, ExecutionTrade>();
  for (const trade of paperTradesQuery.data ?? []) {
    if (trade.status === "rejected" || trade.status === "cancelled") continue;
    if (!paperByOpportunity.has(trade.opportunityId)) {
      paperByOpportunity.set(trade.opportunityId, trade);
    }
  }

  const all = opportunitiesQuery.data ?? [];
  const unread = notificationsQuery.data ?? [];
  const active = all.filter(
    (opportunity) =>
      ACTIVE_STATES.has(opportunity.state) && !opportunity.archived && !opportunity.dismissed
  );
  const entryReady = active.filter((opportunity) => opportunity.state === "entry_ready").length;

  const visible = useMemo(() => {
    const source = view === "active" ? active : all.filter((opportunity) => !opportunity.archived);
    return [...source].sort((a, b) => {
      const rank = (STATE_RANK[a.state] ?? 9) - (STATE_RANK[b.state] ?? 9);
      if (rank !== 0) return rank;
      return Date.parse(a.deadline) - Date.parse(b.deadline);
    });
  }, [all, active, view]);

  // Only treat the scanner-level state as an empty view when there are no
  // setups at all; historical rows must still render even before a scan log.
  const scannerEmpty = all.length === 0 ? emptyState(status, all, false) : null;
  const dismissedOnly =
    view === "active" && visible.length === 0 && all.some((opportunity) => opportunity.dismissed);

  const selectHorizon = (next: Horizon) => {
    if (next === horizon) return;
    setHorizon(next);
    setSelectedId(null);
  };

  const moveSelection = (direction: 1 | -1) => {
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("[data-setup]") ?? []
    );
    if (rows.length === 0) return;
    const current = rows.findIndex((row) => row === document.activeElement);
    const index =
      current === -1
        ? direction === 1
          ? 0
          : rows.length - 1
        : Math.min(rows.length - 1, Math.max(0, current + direction));
    rows[index]?.focus();
    rows[index]?.click();
  };

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    moveSelection(event.key === "ArrowDown" ? 1 : -1);
  };

  return (
    <div className="opportunities-widget">
      <header className="opps-head">
        <div className="opps-head-row">
          <span
            className={`scanner-badge ${
              !status ? "scanner-badge--muted" : status.config.enabled ? "scanner-badge--up" : "scanner-badge--muted"
            }`}
          >
            {!status ? "… Connecting" : status.config.enabled ? "● Live" : "○ Paused"}
          </span>
          <span className="dim">{active.length} active</span>
          {entryReady > 0 && <span className="up">{entryReady} entry ready</span>}
          {unread.length > 0 && <span className="amber">{unread.length} alerts</span>}
          <span className="opps-head-actions">
            <button
              type="button"
              className="term-btn"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ["scanner"] })}
              disabled={opportunitiesQuery.isFetching}
            >
              REFRESH
            </button>
            <button type="button" className="term-btn" onClick={() => setSettingsOpen(true)}>
              SETTINGS
            </button>
          </span>
        </div>
        <div className="opps-head-row">
          <div className="scanner-tabs" role="group" aria-label="Trade horizon">
            {HORIZONS.map((entry) => (
              <button
                key={entry}
                type="button"
                className="scanner-tab"
                data-active={horizon === entry}
                aria-pressed={horizon === entry}
                onClick={() => selectHorizon(entry)}
              >
                {entry.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="scanner-chip"
            data-active={view === "all"}
            aria-pressed={view === "all"}
            onClick={() => setView((current) => (current === "active" ? "all" : "active"))}
          >
            History
          </button>
          <span className="dim text-[10px]">
            {visible.length} shown{opportunitiesQuery.isFetching ? " · updating…" : ""}
          </span>
        </div>
      </header>

      {opportunitiesQuery.isLoading ? (
        <div className="opps-empty dim">
          Loading setups…
          <button
            type="button"
            className="term-btn mt-2"
            onClick={() => void opportunitiesQuery.refetch()}
          >
            RETRY
          </button>
        </div>
      ) : opportunitiesQuery.error ? (
        <div className="opps-empty down">
          {(opportunitiesQuery.error as Error).message}
          <button
            type="button"
            className="term-btn mt-2"
            onClick={() => void opportunitiesQuery.refetch()}
          >
            RETRY
          </button>
        </div>
      ) : scannerEmpty ? (
        <div className="opps-empty">
          <div className="amber font-bold">{scannerEmpty.title}</div>
          <div className="dim">{scannerEmpty.detail}</div>
          <button type="button" className="term-btn mt-2" onClick={() => setSettingsOpen(true)}>
            SCANNER SETTINGS
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="opps-empty">
          <div className="amber font-bold">
            {dismissedOnly
              ? "All active setups are dismissed"
              : view === "active"
                ? "No active setups"
                : "No setups in this horizon"}
          </div>
          <div className="dim">
            {view === "active" && all.length > 0
              ? "Recent setups are available in history."
              : "Qualified setups will appear after the next completed scan."}
          </div>
          {view === "active" && all.length > 0 && (
            <button type="button" className="term-btn mt-2" onClick={() => setView("all")}>
              SHOW HISTORY
            </button>
          )}
        </div>
      ) : (
        <div className="opps-list" ref={listRef} onKeyDown={onListKeyDown}>
          {visible.map((opportunity) => {
            const action = tradeAction(opportunity);
            const deadline = deadlineStatus(opportunity.deadline);
            const selected = selectedId === opportunity.id;
            const paper = paperByOpportunity.get(opportunity.id);
            return (
              <button
                key={opportunity.id}
                type="button"
                data-setup="true"
                className="scanner-card opps-row"
                data-selected={selected}
                aria-current={selected ? "true" : undefined}
                onClick={() => {
                  setPaperError(null);
                  setSelectedId(opportunity.id);
                }}
              >
                <span className="opps-main">
                  <span className="opps-top">
                    <span className="opps-symbol">{opportunity.symbol}</span>
                    <span className={`opps-dir ${directionClass(opportunity.direction)}`}>
                      {opportunity.direction.toUpperCase()}
                    </span>
                    <StateBadge state={opportunity.state} />
                    {opportunity.currentHealth !== "current" && (
                      <HealthBadge health={opportunity.currentHealth} />
                    )}
                    {opportunity.pinned && (
                      <span className="amber text-[10px]" title="Pinned">
                        ★
                      </span>
                    )}
                    {paper && (
                      <span
                        className={`scanner-badge ${
                          paper.status === "open" ? "scanner-badge--up" : "scanner-badge--amber"
                        }`}
                        title={`Paper trade ${paper.status.replaceAll("_", " ")}`}
                      >
                        PAPER
                      </span>
                    )}
                  </span>
                  <span className="opps-meta">
                    {STRATEGY_LABELS[opportunity.strategy] ?? opportunity.strategy}
                    <span className="dim"> · </span>
                    {opportunity.recipeId}
                    <span className="dim"> · </span>
                    {opportunity.horizon}
                  </span>
                  <span className="opps-plan">
                    <span className={action.tone}>{action.title}</span> {action.directive}
                  </span>
                  <span className="opps-levels">{planLine(opportunity)}</span>
                </span>
                <span className="opps-side">
                  <span className="opps-loss">{formatUsd(opportunity.risk.maxLossUsd)}</span>
                  <span className={`opps-deadline ${deadline.tone}`}>{deadline.label}</span>
                  <span className="opps-updated">
                    {formatDateTime(opportunity.lastCheckedAt ?? opportunity.updatedAt)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selectedId && (
        <ScannerOverlay title="Setup detail" onClose={() => setSelectedId(null)}>
          <OpportunityDetail
            opportunityId={selectedId}
            onPin={(opportunity, pinned) => pin.mutate({ id: opportunity.id, pinned })}
            onDismiss={(opportunity) => dismiss.mutate(opportunity.id)}
            onClose={() => setSelectedId(null)}
            paperTrade={
              paperByOpportunity.has(selectedId)
                ? {
                    id: paperByOpportunity.get(selectedId)!.id,
                    status: paperByOpportunity.get(selectedId)!.status,
                  }
                : null
            }
            paperPending={paperEnter.isPending || paperClose.isPending}
            paperError={paperError}
            onPaperTrade={() => {
              setPaperError(null);
              paperEnter.mutate(selectedId);
            }}
            onClosePaper={() => {
              const trade = paperByOpportunity.get(selectedId);
              if (!trade) return;
              setPaperError(null);
              paperClose.mutate(trade.id);
            }}
          />
        </ScannerOverlay>
      )}

      {settingsOpen && (
        <ScannerOverlay
          title="Opportunity scanner settings"
          onClose={() => setSettingsOpen(false)}
          wide
        >
          <ScannerSettings status={status} />
        </ScannerOverlay>
      )}
    </div>
  );
}
