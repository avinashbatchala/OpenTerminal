"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../../lib/api";
import {
  STRATEGY_LABELS,
  emptyState,
  formatDateTime,
  formatUsd,
  legsSummary,
  type Horizon,
  type Opportunity,
  type ScannerNotification,
  type ScannerStatus,
} from "../../lib/scanner";
import { useTerminal } from "../../store/terminal";
import ScannerConfigPanel from "../../components/scanner/ScannerConfigPanel";
import OpportunityDetail from "../../components/scanner/OpportunityDetail";
import { HealthBadge, StateBadge } from "../../components/scanner/StatusBadges";

type WatchlistResponse = {
  ok: boolean;
  added: string[];
  removed: string[];
  config: ScannerStatus["config"];
  pendingWatchlistRemovals: ScannerStatus["pendingWatchlistRemovals"];
  status: ScannerStatus;
};

type ProviderHealth = {
  providers: Array<{
    name: string;
    ok: number;
    failed: number;
    lastLatencyMs: number | null;
  }>;
};

type EmptyNotice = {
  title: string;
  detail: string;
  action?: { label: string; run: () => void };
};

const HORIZONS: Horizon[] = ["intraday", "swing"];
const ACTIVE_STATES = new Set(["watching", "entry_ready"]);
const TERMINAL_STATES = new Set(["invalidated", "expired"]);

function directionClass(direction: string) {
  return direction === "bullish" ? "up" : direction === "bearish" ? "down" : "dim";
}

export default function OpportunitiesPage() {
  const queryClient = useQueryClient();
  const watchlist = useTerminal((state) => state.watchlist);
  const setWatchlist = useTerminal((state) => state.setWatchlist);
  const [horizon, setHorizon] = useState<Horizon>("intraday");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [strategy, setStrategy] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [historyView, setHistoryView] = useState(false);
  const [syncConflict, setSyncConflict] = useState<{ current: string[]; revision: number } | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const watchRevision = useRef<number | null>(null);
  const syncedKey = useRef<string>("");
  const syncInFlight = useRef(false);

  const statusQuery = useQuery({
    queryKey: ["scanner", "status"],
    queryFn: () => apiGet<ScannerStatus>("/api/scanner/status"),
    refetchInterval: 30_000,
    retry: 0,
  });
  const status = statusQuery.data;

  // Always fetch the full horizon (history included) so filters and counts stay
  // instant and the list does not flash when toggling History.
  const opportunitiesQuery = useQuery({
    queryKey: ["scanner", "opportunities", horizon],
    queryFn: () =>
      apiGet<Opportunity[]>(`/api/scanner/opportunities?horizon=${horizon}&history=true&limit=500`),
    enabled: Boolean(status),
    refetchInterval: 30_000,
    retry: 0,
  });

  const notificationsQuery = useQuery({
    queryKey: ["scanner", "notifications", "unread"],
    queryFn: () => apiGet<ScannerNotification[]>("/api/scanner/notifications?unread=true"),
    enabled: Boolean(status),
    refetchInterval: 30_000,
    retry: 0,
  });

  const providerQuery = useQuery({
    queryKey: ["status"],
    queryFn: () => apiGet<ProviderHealth>("/api/status"),
    enabled: Boolean(status),
    refetchInterval: 60_000,
    retry: 0,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["scanner"] });
  };

  const syncMutation = useMutation({
    mutationFn: ({
      symbols,
      baseRevision,
      force,
    }: {
      symbols: string[];
      baseRevision: number | null;
      force: boolean;
    }) =>
      apiPost<WatchlistResponse>("/api/scanner/watchlist", {
        symbols,
        baseRevision,
        force,
      }),
    onSuccess: async (data, variables) => {
      watchRevision.current = data.config.watchlistRevision;
      syncedKey.current = data.config.watchlist.join(",");
      setSyncConflict(null);
      if (data.config.watchlist.join(",") !== variables.symbols.join(",")) {
        setWatchlist(data.config.watchlist);
        setSyncNotice(
          `Only ${data.config.watchlist.length} symbols can be monitored; the synchronized list was truncated.`
        );
      } else {
        setSyncNotice(
          data.removed.length > 0
            ? `Watchlist removed ${data.removed.join(", ")}. Existing setups are still monitored until you choose.`
            : null
        );
      }
      await refresh();
    },
    onError: async (error: Error) => {
      syncedKey.current = "";
      if (!/another tab|409|conflict/i.test(error.message)) {
        setSyncNotice(`Watchlist sync failed: ${error.message}`);
        return;
      }
      const fresh = await statusQuery.refetch();
      const current = fresh.data;
      setSyncConflict(
        current
          ? {
              current: current.config.watchlist,
              revision: current.config.watchlistRevision,
            }
          : { current: [], revision: 0 }
      );
    },
  });

  useEffect(() => {
    if (!status || syncConflict || syncInFlight.current) return;
    if (watchRevision.current === null) {
      watchRevision.current = status.config.watchlistRevision;
    }
    const key = watchlist.join(",");
    if (key === syncedKey.current) return;
    if (key === status.config.watchlist.join(",")) {
      syncedKey.current = key;
      return;
    }
    syncInFlight.current = true;
    void syncMutation
      .mutateAsync({
        symbols: watchlist,
        baseRevision: watchRevision.current,
        force: false,
      })
      .catch(() => {
        // onError records the explicit conflict for the user.
      })
      .finally(() => {
        syncInFlight.current = false;
      });
  }, [status?.config.watchlistRevision, watchlist.join(","), syncConflict]);

  const decide = useMutation({
    mutationFn: ({ symbol, decision }: { symbol: string; decision: "monitor" | "archive" }) =>
      apiPost("/api/scanner/watchlist/decision", { symbol, decision }),
    onSuccess: async () => {
      setSyncNotice("Watchlist removal decision saved.");
      await refresh();
    },
  });

  const pin = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      apiPost(`/api/scanner/opportunities/${encodeURIComponent(id)}/pin`, { pinned }),
    onSuccess: refresh,
  });
  const dismiss = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/api/scanner/opportunities/${encodeURIComponent(id)}/dismiss`, {}),
    onSuccess: refresh,
  });
  const markRead = useMutation({
    mutationFn: () => apiPost("/api/scanner/notifications/read", {}),
    onSuccess: refresh,
  });

  const all = opportunitiesQuery.data ?? [];
  const query = search.trim().toUpperCase();
  const filtered = all.filter((opportunity) => {
    const active = ACTIVE_STATES.has(opportunity.state) && !opportunity.archived;
    if (!historyView && !active) return false;
    if (!includeDismissed && opportunity.dismissed) return false;
    if (pinnedOnly && !opportunity.pinned) return false;
    if (stateFilter !== "all" && opportunity.state !== stateFilter) return false;
    if (strategy !== "all" && opportunity.strategy !== strategy) return false;
    if (
      query &&
      !`${opportunity.symbol} ${STRATEGY_LABELS[opportunity.strategy] ?? opportunity.strategy} ${
        opportunity.recipeId
      }`
        .toUpperCase()
        .includes(query)
    ) {
      return false;
    }
    return true;
  });

  const activeCount = all.filter(
    (opportunity) => ACTIVE_STATES.has(opportunity.state) && !opportunity.archived
  ).length;
  const filtersActive =
    search.trim() !== "" ||
    strategy !== "all" ||
    stateFilter !== "all" ||
    pinnedOnly ||
    includeDismissed;
  const scannerEmpty = emptyState(status, all, filtersActive);

  const clearFilters = () => {
    setSearch("");
    setStrategy("all");
    setStateFilter("all");
    setPinnedOnly(false);
    setIncludeDismissed(false);
  };

  const buildEmptyNotice = (): EmptyNotice | null => {
    if (filtered.length > 0) return null;
    if (scannerEmpty) return scannerEmpty;
    if (!historyView && activeCount === 0 && all.length > 0) {
      return {
        title: "No active setups",
        detail: `${all.length} historical setup${all.length === 1 ? " is" : "s are"} available for this horizon.`,
        action: { label: "Show history", run: () => setHistoryView(true) },
      };
    }
    if (!includeDismissed && all.some((opportunity) => opportunity.dismissed)) {
      return {
        title: "All matching setups are dismissed",
        detail: "Dismissed setups stay monitored but are hidden by default.",
        action: { label: "Show dismissed", run: () => setIncludeDismissed(true) },
      };
    }
    return {
      title: "No matches",
      detail: "No setups match the current search and filters.",
      action: filtersActive ? { label: "Clear filters", run: clearFilters } : undefined,
    };
  };
  const emptyNotice = buildEmptyNotice();

  const lastRun = status?.lastRun;
  const unread = notificationsQuery.data ?? [];
  const recipeNames = new Map((status?.definitions ?? []).map((definition) => [definition.id, definition.name]));

  const selectHorizon = (next: Horizon) => {
    if (next === horizon) return;
    setHorizon(next);
    // Setups are scoped to a horizon; keeping the old selection would leave a
    // stale symbol analysis beside the new list.
    setSelectedId(null);
  };

  const useServerWatchlist = () => {
    if (!syncConflict) return;
    setWatchlist(syncConflict.current);
    watchRevision.current = syncConflict.revision;
    syncedKey.current = syncConflict.current.join(",");
    setSyncConflict(null);
    setSyncNotice("Using the server watchlist from the other tab.");
  };

  const overwriteWatchlist = () => {
    if (!syncConflict) return;
    syncInFlight.current = true;
    void syncMutation
      .mutateAsync({
        symbols: watchlist,
        baseRevision: syncConflict.revision,
        force: true,
      })
      .catch(() => {
        // onError keeps the conflict visible.
      })
      .finally(() => {
        syncInFlight.current = false;
      });
  };

  return (
    <div className="h-screen overflow-auto">
      <header className="sticky top-0 z-20 flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 text-[11px]">
        <span className="amber font-bold tracking-[0.18em]">OPPORTUNITY SCANNER</span>
        <Link href="/" className="dim hover:text-[var(--amber)]">
          ← Terminal
        </Link>
        <Link href="/settings" className="dim hover:text-[var(--amber)]">
          Settings
        </Link>
        <span className="ml-auto flex flex-wrap items-center gap-2 text-[10px]">
          {status && (
            <>
              <span
                className={`scanner-badge ${
                  status.config.enabled ? "scanner-badge--up" : "scanner-badge--muted"
                }`}
              >
                {status.config.enabled ? "● Live" : "○ Paused"}
              </span>
              <span className="dim">{status.session.label}</span>
              <span className="dim">
                Watchlist {status.config.watchlist.length}/{status.config.maxWatchlistSymbols}
              </span>
            </>
          )}
        </span>
      </header>

      <main className="mx-auto w-full max-w-[1700px] space-y-3 p-3">
        {statusQuery.error && (
          <div role="alert" className="rounded-md border border-[var(--down)] bg-[var(--panel)] px-3 py-2 text-[11px] down">
            {(statusQuery.error as Error).message}
          </div>
        )}

        {status && (
          <>
            <section className="scanner-panel">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-[11px]">
                <span className={status.config.enabled ? "up font-bold" : "down font-bold"}>
                  {status.config.enabled ? "● ENABLED" : "○ PAUSED"}
                </span>
                <span className={status.readiness.ready ? "up" : "amber"}>
                  {status.readiness.ready ? "READY" : "CONFIG REQUIRED"}
                </span>
                <span className="h-3 w-px bg-[var(--border)]" aria-hidden="true" />
                <span className="dim">
                  Session <span className="text-[var(--text)]">{status.session.label}</span>
                </span>
                <span className="dim">
                  Last scan{" "}
                  <span className="text-[var(--text)]">
                    {lastRun ? `${formatDateTime(lastRun.startedAt)} · ${lastRun.status}` : "none"}
                  </span>
                </span>
                <span className="dim">
                  Next{" "}
                  <span className="text-[var(--text)]">
                    {status.nextScheduledAt ? formatDateTime(status.nextScheduledAt) : "—"}
                  </span>
                </span>
                {status.unreadNotifications > 0 && (
                  <span className="amber">{status.unreadNotifications} unread alert{status.unreadNotifications === 1 ? "" : "s"}</span>
                )}
              </div>

              <details className="border-t border-[var(--border)]">
                <summary className="scanner-summary">Scanner health, coverage &amp; usage</summary>
                <div className="space-y-2 px-2 pb-2 text-[11px]">
                  <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 xl:grid-cols-6">
                    <div>
                      <div className="dim text-[9px] uppercase">Session</div>
                      {status.session.label}
                    </div>
                    <div>
                      <div className="dim text-[9px] uppercase">Last scan</div>
                      {lastRun ? `${formatDateTime(lastRun.startedAt)} · ${lastRun.status}` : "none"}
                    </div>
                    <div>
                      <div className="dim text-[9px] uppercase">Next scheduled</div>
                      {status.nextScheduledAt ? formatDateTime(status.nextScheduledAt) : "—"}
                    </div>
                    <div>
                      <div className="dim text-[9px] uppercase">Scan interval</div>
                      {status.config.scanIntervalMinutes} min
                    </div>
                    <div>
                      <div className="dim text-[9px] uppercase">Unread alerts</div>
                      {status.unreadNotifications}
                    </div>
                    <div>
                      <div className="dim text-[9px] uppercase">AI usage</div>
                      {status.aiUsage.estimatedCostUsd === null
                        ? `${status.aiUsage.inputTokens + status.aiUsage.outputTokens} tokens · cost unknown · ${
                            status.aiUsage.unknownCostAssessments
                          } unpriced assessment(s)`
                        : `${status.aiUsage.inputTokens + status.aiUsage.outputTokens} tokens · ${formatUsd(
                            status.aiUsage.estimatedCostUsd
                          )}`}
                    </div>
                  </div>

                  <div className="dim">
                    Synced watchlist (edit in Terminal):{" "}
                    <span className="text-[var(--text)]">
                      {status.config.watchlist.length > 0 ? status.config.watchlist.join(", ") : "(empty)"}
                    </span>
                  </div>

                  {providerQuery.data && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2 text-[10px]">
                      <span className="dim uppercase tracking-wide">Provider health</span>
                      {providerQuery.data.providers.map((provider) => (
                        <span
                          key={provider.name}
                          className={provider.failed > 0 ? "amber" : "up"}
                          title={`${provider.ok} ok / ${provider.failed} failed${
                            provider.lastLatencyMs === null ? "" : ` · ${provider.lastLatencyMs}ms`
                          }`}
                        >
                          {provider.name} {provider.ok}/{provider.ok + provider.failed}
                        </span>
                      ))}
                    </div>
                  )}

                  {lastRun?.coverage && lastRun.coverage.length > 0 && (
                    <details className="border-t border-[var(--border)] pt-2">
                      <summary className="scanner-summary px-0">
                        Coverage and held/excluded symbols ({lastRun.coverage.length})
                      </summary>
                      <div className="mt-1 overflow-x-auto" tabIndex={0} role="region" aria-label="Scan coverage">
                        <table className="data-table min-w-[720px]">
                          <thead>
                            <tr>
                              <th>Symbol</th>
                              <th>Coverage</th>
                              <th>Reason</th>
                              <th>Recipes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lastRun.coverage.map((entry) => (
                              <tr key={entry.symbol}>
                                <td className="font-bold">{entry.symbol}</td>
                                <td
                                  className={
                                    entry.status === "scanned"
                                      ? "up"
                                      : entry.status === "failed"
                                        ? "down"
                                        : "amber"
                                  }
                                >
                                  {entry.status}
                                </td>
                                <td className="dim">{entry.reason ?? "—"}</td>
                                <td className="dim text-[10px]">
                                  {Object.entries(entry.recipes)
                                    .map(([key, value]) => `${key}: ${value}`)
                                    .join(" · ")}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {lastRun.failures.length > 0 && (
                        <ul className="mt-1 list-disc pl-4 text-[10px] down">
                          {lastRun.failures.map((failure) => (
                            <li key={failure}>{failure}</li>
                          ))}
                        </ul>
                      )}
                    </details>
                  )}
                </div>
              </details>
            </section>

            {status.monitoringGaps.length > 0 && (
              <div role="alert" className="rounded-md border border-[var(--down)] bg-[var(--panel)] px-3 py-2 text-[10px] down">
                Monitoring gaps: {status.monitoringGaps.join(" · ")}
              </div>
            )}

            <details
              className="scanner-panel"
              open={!status.config.enabled || !status.readiness.ready}
            >
              <summary className="scanner-summary">Configuration &amp; activation review</summary>
              <div className="border-t border-[var(--border)] p-2">
                <ScannerConfigPanel status={status} />
              </div>
            </details>

            {status.pendingWatchlistRemovals.length > 0 && (
              <section className="rounded-md border border-[var(--amber-dim)] bg-[var(--panel)] p-2.5 text-[11px]">
                <div className="amber font-bold">Watchlist removals need a monitoring decision</div>
                <div className="dim">
                  New discovery is stopped for these symbols. Existing setups remain in monitoring until you choose.
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {status.pendingWatchlistRemovals.map((removal) => (
                    <div
                      key={removal.symbol}
                      className="flex items-center gap-1.5 rounded border border-[var(--border)] px-2 py-1"
                    >
                      <span className="font-bold">{removal.symbol}</span>
                      <span className="dim">{removal.opportunityIds.length} setup(s)</span>
                      <button
                        type="button"
                        className="term-btn"
                        onClick={() => decide.mutate({ symbol: removal.symbol, decision: "monitor" })}
                      >
                        KEEP MONITORING
                      </button>
                      <button
                        type="button"
                        className="term-btn"
                        onClick={() => decide.mutate({ symbol: removal.symbol, decision: "archive" })}
                      >
                        ARCHIVE
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {syncConflict && (
              <section
                role="alert"
                className="rounded-md border border-[var(--down)] bg-[var(--panel)] p-2.5 text-[11px]"
              >
                <div className="down font-bold">Watchlist changed in another tab</div>
                <div className="dim">Server list: {syncConflict.current.join(", ") || "(empty)"}</div>
                <div className="mt-2 flex gap-2">
                  <button type="button" className="term-btn" onClick={useServerWatchlist}>
                    USE SERVER LIST
                  </button>
                  <button type="button" className="term-btn" onClick={overwriteWatchlist}>
                    OVERWRITE WITH THIS TAB
                  </button>
                </div>
              </section>
            )}
            {syncNotice && (
              <div role="status" className="text-[11px] amber">
                {syncNotice}
              </div>
            )}

            {unread.length > 0 && (
              <section className="scanner-panel p-2.5 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="amber font-bold">Unread scanner alerts ({unread.length})</span>
                  <button
                    type="button"
                    className="term-btn ml-auto"
                    onClick={() => markRead.mutate()}
                    disabled={markRead.isPending}
                  >
                    MARK ALL READ
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {unread.slice(0, 12).map((notification) => (
                    <button
                      key={notification.id}
                      type="button"
                      className="scanner-chip"
                      onClick={() => {
                        setHistoryView(true);
                        setSelectedId(notification.opportunityId);
                      }}
                    >
                      <span
                        className={
                          notification.type === "invalidated"
                            ? "down"
                            : notification.type === "entry_ready"
                              ? "up"
                              : "amber"
                        }
                      >
                        {notification.type.replaceAll("_", " ")}
                      </span>{" "}
                      <span className="dim">{formatDateTime(notification.createdAt)}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(340px,430px)] xl:grid-cols-[minmax(0,1fr)_minmax(380px,520px)]">
              <section
                className={`scanner-panel ${selectedId ? "hidden lg:block" : ""}`}
                aria-label="Opportunity list"
              >
                <div className="space-y-2 border-b border-[var(--border)] p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="scanner-tabs" role="group" aria-label="Trade horizon">
                      {HORIZONS.map((entry) => (
                        <button
                          key={entry}
                          type="button"
                          aria-pressed={horizon === entry}
                          className="scanner-tab"
                          data-active={horizon === entry}
                          onClick={() => selectHorizon(entry)}
                        >
                          {entry.toUpperCase()}
                        </button>
                      ))}
                    </div>
                    <span className="text-[10px] dim">
                      {filtered.length} shown · {activeCount} active
                    </span>
                    {opportunitiesQuery.isFetching && <span className="text-[10px] dim">updating…</span>}
                    <button
                      type="button"
                      className="term-btn ml-auto"
                      onClick={() => void refresh()}
                      disabled={opportunitiesQuery.isFetching}
                    >
                      REFRESH
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search symbol, strategy or recipe"
                      aria-label="Search opportunities"
                      className="min-w-[180px] flex-1"
                    />
                    <select
                      value={strategy}
                      onChange={(event) => setStrategy(event.target.value)}
                      aria-label="Filter by strategy"
                    >
                      <option value="all">All strategies</option>
                      {Object.entries(STRATEGY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={stateFilter}
                      onChange={(event) => {
                        const value = event.target.value;
                        setStateFilter(value);
                        if (TERMINAL_STATES.has(value)) setHistoryView(true);
                      }}
                      aria-label="Filter by lifecycle state"
                    >
                      <option value="all">All states</option>
                      <option value="watching">Watching</option>
                      <option value="entry_ready">Entry ready</option>
                      <option value="invalidated">Invalidated</option>
                      <option value="expired">Expired</option>
                    </select>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className="scanner-chip"
                      data-active={pinnedOnly}
                      aria-pressed={pinnedOnly}
                      onClick={() => setPinnedOnly((value) => !value)}
                    >
                      ★ Pinned
                    </button>
                    <button
                      type="button"
                      className="scanner-chip"
                      data-active={includeDismissed}
                      aria-pressed={includeDismissed}
                      onClick={() => setIncludeDismissed((value) => !value)}
                    >
                      Dismissed
                    </button>
                    <button
                      type="button"
                      className="scanner-chip"
                      data-active={historyView}
                      aria-pressed={historyView}
                      onClick={() => {
                        const next = !historyView;
                        setHistoryView(next);
                        if (!next && TERMINAL_STATES.has(stateFilter)) setStateFilter("all");
                      }}
                    >
                      History
                    </button>
                    {filtersActive && (
                      <button
                        type="button"
                        className="ml-auto text-[10px] dim underline hover:text-[var(--amber)]"
                        onClick={clearFilters}
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                </div>

                {opportunitiesQuery.isLoading ? (
                  <div className="p-6 text-center text-[11px] dim">Loading setups…</div>
                ) : opportunitiesQuery.error ? (
                  <div role="alert" className="p-4 text-[11px] down">
                    {(opportunitiesQuery.error as Error).message}
                  </div>
                ) : emptyNotice ? (
                  <div className="p-6 text-center">
                    <div className="amber text-[12px] font-bold">{emptyNotice.title}</div>
                    <div className="mx-auto mt-1 max-w-lg text-[11px] dim">{emptyNotice.detail}</div>
                    {emptyNotice.action && (
                      <button type="button" className="term-btn mt-3" onClick={emptyNotice.action.run}>
                        {emptyNotice.action.label.toUpperCase()}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5 p-2">
                    {filtered.map((opportunity) => {
                      const selected = selectedId === opportunity.id;
                      return (
                        <button
                          key={opportunity.id}
                          type="button"
                          className="scanner-card"
                          data-selected={selected}
                          aria-current={selected ? "true" : undefined}
                          onClick={() => setSelectedId(opportunity.id)}
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="amber text-[14px] font-bold">{opportunity.symbol}</span>
                                {opportunity.pinned && (
                                  <span className="amber text-[10px]" title="Pinned">
                                    ★
                                  </span>
                                )}
                                <StateBadge state={opportunity.state} />
                                {opportunity.currentHealth !== "current" && (
                                  <HealthBadge health={opportunity.currentHealth} />
                                )}
                                {opportunity.dismissed && (
                                  <span className="scanner-badge scanner-badge--muted">Muted</span>
                                )}
                                {opportunity.archived && (
                                  <span className="scanner-badge scanner-badge--muted">Archived</span>
                                )}
                              </span>
                              <span className="mt-1 block truncate text-[11px] dim">
                                <span className={directionClass(opportunity.direction)}>
                                  {opportunity.direction.toUpperCase()}
                                </span>
                                {" · "}
                                {STRATEGY_LABELS[opportunity.strategy] ?? opportunity.strategy}
                                {" · "}
                                {recipeNames.get(opportunity.recipeId) ?? opportunity.recipeId}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block text-[12px]">{formatUsd(opportunity.risk.maxLossUsd)}</span>
                              <span className="block text-[9px] uppercase tracking-wide dim">Max loss</span>
                            </span>
                          </span>
                          <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] dim">
                            <span>Exp {opportunity.expiry}</span>
                            <span>Updated {formatDateTime(opportunity.lastCheckedAt ?? opportunity.updatedAt)}</span>
                            <span>
                              {opportunity.legs.length} leg{opportunity.legs.length === 1 ? "" : "s"}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] dim">
                            {legsSummary(opportunity)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <aside className={`${selectedId ? "block" : "hidden lg:block"} lg:sticky lg:top-[52px]`}>
                {selectedId ? (
                  <div className="lg:max-h-[calc(100vh-64px)] lg:overflow-y-auto">
                    <OpportunityDetail
                      key={selectedId}
                      opportunityId={selectedId}
                      onPin={(opportunity, pinned) => pin.mutate({ id: opportunity.id, pinned })}
                      onDismiss={(opportunity) => dismiss.mutate(opportunity.id)}
                      onClose={() => setSelectedId(null)}
                    />
                  </div>
                ) : (
                  <div className="scanner-panel p-6 text-center">
                    <div className="amber text-[12px] font-bold">No setup selected</div>
                    <div className="mx-auto mt-1 max-w-xs text-[11px] dim">
                      Choose a setup to inspect its legs, risk, frozen conditions, AI assessment, and lifecycle
                      history.
                    </div>
                  </div>
                )}
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
