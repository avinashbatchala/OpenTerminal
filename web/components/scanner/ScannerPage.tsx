"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../../lib/api";
import { deadlineStatus, tradeAction } from "../../lib/opportunityInsight";
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
import { HealthBadge, StateBadge } from "./StatusBadges";
import OpportunityDetail from "./OpportunityDetail";
import ScannerOverlay from "./ScannerOverlay";
import ScannerSettings from "./ScannerSettings";
import { PageHeader, Surface } from "../shell/Surface";
import Tag from "../ui/Tag";
import DirectionTag from "../ui/DirectionTag";

const ACTIVE_STATES = new Set(["watching", "entry_ready"]);
const HORIZONS: Horizon[] = ["intraday", "swing"];
const STATE_RANK: Record<string, number> = {
  entry_ready: 0,
  watching: 1,
  missed: 2,
  invalidated: 3,
  expired: 4,
};

type View = "active" | "history";

function scanTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ScannerPage() {
  const queryClient = useQueryClient();
  const [horizon, setHorizon] = useState<Horizon>("intraday");
  const [view, setView] = useState<View>("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paperError, setPaperError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

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
  const all = opportunitiesQuery.data ?? [];

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
  const unread = notificationsQuery.data ?? [];

  const active = useMemo(
    () =>
      all.filter(
        (opportunity) =>
          ACTIVE_STATES.has(opportunity.state) && !opportunity.archived && !opportunity.dismissed
      ),
    [all]
  );
  const entryReady = active.filter((opportunity) => opportunity.state === "entry_ready").length;
  const watching = active.length - entryReady;

  const paperByOpportunity = useMemo(() => {
    const map = new Map<string, ExecutionTrade>();
    for (const trade of paperTradesQuery.data ?? []) {
      if (trade.status === "rejected" || trade.status === "cancelled") continue;
      if (!map.has(trade.opportunityId)) map.set(trade.opportunityId, trade);
    }
    return map;
  }, [paperTradesQuery.data]);

  const paperOpen = (paperTradesQuery.data ?? []).filter((trade) => trade.status === "open").length;

  const visible = useMemo(() => {
    const source = view === "active" ? active : all.filter((opportunity) => !opportunity.archived);
    return [...source].sort((a, b) => {
      const rank = (STATE_RANK[a.state] ?? 9) - (STATE_RANK[b.state] ?? 9);
      return rank !== 0 ? rank : Date.parse(a.deadline) - Date.parse(b.deadline);
    });
  }, [active, all, view]);

  const selected = all.find((opportunity) => opportunity.id === selectedId) ?? null;
  const selectedPaper = selected ? paperByOpportunity.get(selected.id) ?? null : null;

  useEffect(() => {
    if (isMobile) return;
    if (selectedId && visible.some((opportunity) => opportunity.id === selectedId)) return;
    setSelectedId(visible[0]?.id ?? null);
  }, [isMobile, selectedId, visible]);

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
  const paperEnter = useMutation({
    mutationFn: (opportunityId: string) =>
      apiPost("/api/execution/enter", { opportunityId }),
    onSuccess: async () => {
      setPaperError(null);
      await queryClient.invalidateQueries({ queryKey: ["execution"] });
      await queryClient.invalidateQueries({ queryKey: ["scanner"] });
    },
    onError: (error: Error) => setPaperError(error.message),
  });
  const paperClose = useMutation({
    mutationFn: (tradeId: string) =>
      apiPost(`/api/execution/trades/${encodeURIComponent(tradeId)}/close`, {}),
    onSuccess: async () => {
      setPaperError(null);
      await queryClient.invalidateQueries({ queryKey: ["execution"] });
      await queryClient.invalidateQueries({ queryKey: ["scanner"] });
    },
    onError: (error: Error) => setPaperError(error.message),
  });

  const paperPending = paperEnter.isPending || paperClose.isPending;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["scanner"] });

  const selectHorizon = (next: Horizon) => {
    if (next === horizon) return;
    setHorizon(next);
    setSelectedId(null);
  };

  const changeView = (next: View) => {
    if (next === view) return;
    setView(next);
    setSelectedId(null);
  };

  const selectRow = (id: string) => {
    setPaperError(null);
    setSelectedId(id);
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

  const scannerEmpty = all.length === 0 ? emptyState(status, all, false) : null;

  const detail = selected ? (
    <OpportunityDetail
      opportunityId={selected.id}
      onPin={(opportunity, pinned) => pin.mutate({ id: opportunity.id, pinned })}
      onDismiss={(opportunity) => dismiss.mutate(opportunity.id)}
      paperTrade={selectedPaper ? { id: selectedPaper.id, status: selectedPaper.status } : null}
      paperPending={paperPending}
      paperError={paperError}
      onPaperTrade={
        selected.state === "entry_ready" && !selectedPaper
          ? () => {
              setPaperError(null);
              paperEnter.mutate(selected.id);
            }
          : undefined
      }
      onClosePaper={
        selectedPaper?.status === "open"
          ? () => {
              setPaperError(null);
              paperClose.mutate(selectedPaper.id);
            }
          : undefined
      }
    />
  ) : null;

  return (
    <div className="edge-page edge-scanner-page-wrap">
      <PageHeader
        title="Scanner"
        lead="The setups moving from watching to entry ready, with the plan and paper action in one place."
      />

      <section className="edge-scanner-band">
        <div className="edge-scanner-band-id">
          <div className="edge-scanner-band-line">
            <Tag tone={status?.config.enabled ? "accent" : "neutral"}>
              {status ? (status.config.enabled ? "Live" : "Paused") : "Connecting"}
            </Tag>
            {status && !status.readiness.ready && <Tag>Needs setup</Tag>}
            <span className="edge-muted">Last scan {scanTime(status?.lastRun?.startedAt)}</span>
            <span className="edge-muted">Next {scanTime(status?.nextScheduledAt)}</span>
          </div>
          <dl className="edge-scanner-band-stats">
            <div>
              <dt>Active</dt>
              <dd>{active.length}</dd>
            </div>
            <div>
              <dt>Entry ready</dt>
              <dd>{entryReady}</dd>
            </div>
            <div>
              <dt>Watching</dt>
              <dd>{watching}</dd>
            </div>
            <div>
              <dt>Paper open</dt>
              <dd>{paperOpen}</dd>
            </div>
            <div>
              <dt>Alerts</dt>
              <dd>{unread.length}</dd>
            </div>
          </dl>
        </div>
        <div className="edge-scanner-band-actions">
          <button type="button" className="edge-btn" onClick={() => void refresh()} disabled={opportunitiesQuery.isFetching}>
            {opportunitiesQuery.isFetching ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" className="edge-btn" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </section>

      <div className="edge-scanner-main">
        <Surface flush className="edge-scanner-queue">
          <div className="edge-scanner-queue-head">
            <div className="edge-tabs" role="group" aria-label="Scanner horizon">
              {HORIZONS.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className="edge-tab"
                  data-active={horizon === entry}
                  aria-pressed={horizon === entry}
                  onClick={() => selectHorizon(entry)}
                >
                  {entry === "intraday" ? "Intraday" : "Swing"}
                </button>
              ))}
            </div>
            <div className="edge-scanner-queue-actions">
              <div className="edge-tabs" role="group" aria-label="Scanner view">
                <button
                  type="button"
                  className="edge-tab"
                  data-active={view === "active"}
                  aria-pressed={view === "active"}
                  onClick={() => changeView("active")}
                >
                  Active
                </button>
                <button
                  type="button"
                  className="edge-tab"
                  data-active={view === "history"}
                  aria-pressed={view === "history"}
                  onClick={() => changeView("history")}
                >
                  History
                </button>
              </div>
              <span className="edge-muted text-[11px]">
                {visible.length} shown
                {opportunitiesQuery.isFetching ? ", updating…" : ""}
              </span>
            </div>
          </div>

          {opportunitiesQuery.isLoading ? (
            <div className="edge-empty">Loading setups…</div>
          ) : opportunitiesQuery.error ? (
            <div className="edge-empty down">
              {(opportunitiesQuery.error as Error).message}
              <button type="button" className="edge-btn edge-btn--sm mt-2" onClick={() => void opportunitiesQuery.refetch()}>
                Retry
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="edge-empty">
              <div className="amber font-bold">
                {scannerEmpty?.title ??
                  (view === "active" ? "No active setups" : "No setups in this horizon")}
              </div>
              <div>{scannerEmpty?.detail ?? "Qualified setups will appear after the next completed scan."}</div>
              {view === "active" && all.length > 0 ? (
                <button type="button" className="edge-btn edge-btn--sm mt-2" onClick={() => changeView("history")}>
                  Show history
                </button>
              ) : (
                <button type="button" className="edge-btn edge-btn--sm mt-2" onClick={() => setSettingsOpen(true)}>
                  Scanner settings
                </button>
              )}
            </div>
          ) : (
            <div className="edge-scanner-list" ref={listRef} onKeyDown={onListKeyDown}>
              {visible.map((opportunity) => {
                const action = tradeAction(opportunity);
                const deadline = deadlineStatus(opportunity.deadline);
                const paper = paperByOpportunity.get(opportunity.id);
                const levels = opportunity.conditions.levels;
                return (
                  <button
                    key={opportunity.id}
                    type="button"
                    data-setup="true"
                    data-active={selectedId === opportunity.id}
                    className="edge-scanner-row"
                    onClick={() => selectRow(opportunity.id)}
                  >
                    <span className="edge-scanner-row-main">
                      <span className="edge-scanner-row-top">
                        <span className="edge-scanner-symbol">{opportunity.symbol}</span>
                        <DirectionTag direction={opportunity.direction} />
                        <StateBadge state={opportunity.state} />
                        {opportunity.currentHealth !== "current" && (
                          <HealthBadge health={opportunity.currentHealth} />
                        )}
                        {opportunity.pinned && <Tag tone="accent">Pinned</Tag>}
                      </span>
                      <span className="edge-scanner-row-sub">
                        {STRATEGY_LABELS[opportunity.strategy] ?? opportunity.strategy}, {opportunity.horizon}
                      </span>
                      <span className="edge-scanner-row-plan">
                        <span className={action.tone}>{action.title}</span> {action.directive}
                      </span>
                    </span>

                    <span className="edge-scanner-row-levels">
                      <span className="edge-scanner-level">
                        <span className="edge-scanner-level-label">Entry</span>
                        <span className="edge-scanner-level-value">{formatUsd(levels.entry)}</span>
                      </span>
                      <span className="edge-scanner-level">
                        <span className="edge-scanner-level-label">Target</span>
                        <span className="edge-scanner-level-value">{formatUsd(levels.target)}</span>
                      </span>
                      <span className="edge-scanner-level">
                        <span className="edge-scanner-level-label">Risk</span>
                        <span className="edge-scanner-level-value">{formatUsd(opportunity.risk.maxLossUsd)}</span>
                      </span>
                    </span>

                    <span className="edge-scanner-row-side">
                      {paper && (
                        <Tag
                          tone={
                            paper.status === "open"
                              ? "up"
                              : paper.status === "closed"
                                ? "neutral"
                                : "accent"
                          }
                        >
                          Paper
                        </Tag>
                      )}
                      <span className={`edge-scanner-deadline ${deadline.tone}`}>{deadline.label}</span>
                      <span className="edge-scanner-checked">
                        {formatDateTime(opportunity.lastCheckedAt ?? opportunity.updatedAt)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Surface>

        {!isMobile && (
          <aside className="edge-scanner-detail">
            {detail ?? (
              <Surface className="edge-scanner-detail-empty">
                <div className="edge-empty">
                  Select a setup to inspect the plan, levels, legs and paper action.
                </div>
              </Surface>
            )}
          </aside>
        )}
      </div>

      {isMobile && selected && (
        <ScannerOverlay title="Setup detail" wide onClose={() => setSelectedId(null)}>
          <div className="edge-scanner-mobile-detail">{detail}</div>
        </ScannerOverlay>
      )}

      {settingsOpen && (
        <ScannerOverlay title="Scanner settings" wide onClose={() => setSettingsOpen(false)}>
          <ScannerSettings status={status} />
        </ScannerOverlay>
      )}
    </div>
  );
}
