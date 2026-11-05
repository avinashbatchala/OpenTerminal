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

function StateBadge({ state }: { state: string }) {
  const className =
    state === "entry_ready"
      ? "up"
      : state === "invalidated"
      ? "down"
      : state === "expired"
      ? "dim"
      : "amber";
  return <span className={className}>{state.replace("_", " ").toUpperCase()}</span>;
}

function HealthBadge({ health }: { health: string }) {
  return (
    <span className={health === "current" ? "up" : health === "stale" ? "amber" : "down"}>
      {health.toUpperCase()}
    </span>
  );
}

export default function OpportunitiesPage() {
  const queryClient = useQueryClient();
  const watchlist = useTerminal((state) => state.watchlist);
  const setWatchlist = useTerminal((state) => state.setWatchlist);
  const [horizon, setHorizon] = useState<Horizon>("intraday");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const opportunitiesQuery = useQuery({
    queryKey: ["scanner", "opportunities", horizon, historyView],
    queryFn: () =>
      apiGet<Opportunity[]>(
        `/api/scanner/opportunities?horizon=${horizon}&history=true&limit=500`
      ),
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
  const filtered = all.filter((opportunity) => {
    if (!historyView && !["watching", "entry_ready"].includes(opportunity.state)) return false;
    if (!historyView && opportunity.archived) return false;
    if (!includeDismissed && opportunity.dismissed) return false;
    if (pinnedOnly && !opportunity.pinned) return false;
    if (stateFilter !== "all" && opportunity.state !== stateFilter) return false;
    if (strategy !== "all" && opportunity.strategy !== strategy) return false;
    return true;
  });
  const empty =
    filtered.length === 0
      ? emptyState(
          status,
          filtered,
          strategy !== "all" || stateFilter !== "all" || pinnedOnly || includeDismissed
        )
      : null;
  const lastRun = status?.lastRun;
  const unread = notificationsQuery.data ?? [];

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
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 px-3 h-9 bg-[var(--panel-2)] border-b border-[var(--border)] text-[11px]">
        <span className="amber font-bold tracking-widest">OPPORTUNITY SCANNER</span>
        <Link href="/" className="dim hover:text-[var(--amber)]">← TERMINAL</Link>
        <Link href="/settings" className="dim hover:text-[var(--amber)]">⚙ SETTINGS</Link>
        <span className="dim ml-auto">
          {status ? `${status.session.label} · watchlist ${status.config.watchlist.length}/${status.config.maxWatchlistSymbols}` : "loading…"}
        </span>
      </header>

      <main className="p-3 space-y-3">
        {statusQuery.error && (
          <div className="border border-[var(--down)] p-2 down text-[11px]">
            {(statusQuery.error as Error).message}
          </div>
        )}

        {status && (
          <>
            <section className="border border-[var(--border)] bg-[var(--panel)]">
              <div className="panel-title cursor-default">
                <span>Scanner status</span>
                <span className="flex gap-2">
                  <span className={status.config.enabled ? "up" : "down"}>
                    {status.config.enabled ? "● ENABLED" : "○ PAUSED"}
                  </span>
                  <span className={status.readiness.ready ? "up" : "amber"}>
                    {status.readiness.ready ? "READY" : "CONFIG REQUIRED"}
                  </span>
                </span>
              </div>
              <div className="p-2 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-1.5 text-[11px]">
                <div><div className="dim text-[9px] uppercase">Session</div>{status.session.label}</div>
                <div><div className="dim text-[9px] uppercase">Last scan</div>{lastRun ? `${formatDateTime(lastRun.startedAt)} · ${lastRun.status}` : "none"}</div>
                <div><div className="dim text-[9px] uppercase">Next scheduled</div>{status.nextScheduledAt ? formatDateTime(status.nextScheduledAt) : "—"}</div>
                <div><div className="dim text-[9px] uppercase">Scan interval</div>{status.config.scanIntervalMinutes} min</div>
                <div><div className="dim text-[9px] uppercase">Unread alerts</div>{status.unreadNotifications}</div>
                <div>
                  <div className="dim text-[9px] uppercase">AI usage</div>
                  {status.aiUsage.estimatedCostUsd === null
                    ? `${status.aiUsage.inputTokens + status.aiUsage.outputTokens} tokens · cost unknown · ${status.aiUsage.unknownCostAssessments} unpriced assessment(s)`
                    : `${status.aiUsage.inputTokens + status.aiUsage.outputTokens} tokens · ${formatUsd(status.aiUsage.estimatedCostUsd)}`}
                </div>
              </div>
              {providerQuery.data && (
                <div className="border-t border-[var(--border)] px-2 py-1 flex flex-wrap gap-2 text-[10px]">
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
                <details className="border-t border-[var(--border)] p-2 text-[11px]">
                  <summary className="cursor-pointer dim text-[9px] uppercase tracking-wide">
                    Coverage and held/excluded symbols ({lastRun.coverage.length})
                  </summary>
                  <div className="overflow-x-auto mt-2" tabIndex={0} role="region" aria-label="Scan coverage">
                    <table className="data-table min-w-[720px]">
                      <thead><tr><th>Symbol</th><th>Coverage</th><th>Reason</th><th>Recipes</th></tr></thead>
                      <tbody>
                        {lastRun.coverage.map((entry) => (
                          <tr key={entry.symbol}>
                            <td className="font-bold">{entry.symbol}</td>
                            <td className={entry.status === "scanned" ? "up" : entry.status === "failed" ? "down" : "amber"}>{entry.status}</td>
                            <td className="dim">{entry.reason ?? "—"}</td>
                            <td className="dim text-[10px]">{Object.entries(entry.recipes).map(([key, value]) => `${key}: ${value}`).join(" · ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {lastRun.failures.length > 0 && (
                    <ul className="list-disc pl-4 down text-[10px] mt-2">
                      {lastRun.failures.map((failure) => <li key={failure}>{failure}</li>)}
                    </ul>
                  )}
                </details>
              )}
              {status.monitoringGaps.length > 0 && (
                <div className="border-t border-[var(--border)] p-2 text-[10px] down">
                  Monitoring gaps: {status.monitoringGaps.join(" · ")}
                </div>
              )}
            </section>

            <details
              className="border border-[var(--border)] bg-[var(--panel)]"
              open={!status.config.enabled || !status.readiness.ready}
            >
              <summary className="panel-title cursor-pointer">
                Configuration and activation review
              </summary>
              <div className="p-2">
                <ScannerConfigPanel status={status} />
              </div>
            </details>

            {status.pendingWatchlistRemovals.length > 0 && (
              <section className="border border-[var(--amber-dim)] bg-[var(--panel)] p-2 text-[11px]">
                <div className="amber font-bold">Watchlist removals need a monitoring decision</div>
                <div className="dim">
                  New discovery is stopped for these symbols. Existing setups remain in monitoring until you choose.
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {status.pendingWatchlistRemovals.map((removal) => (
                    <div key={removal.symbol} className="flex items-center gap-1 border border-[var(--border)] px-2 py-1">
                      <span className="font-bold">{removal.symbol}</span>
                      <span className="dim">{removal.opportunityIds.length} setup(s)</span>
                      <button type="button" className="term-btn" onClick={() => decide.mutate({ symbol: removal.symbol, decision: "monitor" })}>
                        KEEP MONITORING
                      </button>
                      <button type="button" className="term-btn" onClick={() => decide.mutate({ symbol: removal.symbol, decision: "archive" })}>
                        ARCHIVE
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {syncConflict && (
              <section className="border border-[var(--down)] bg-[var(--panel)] p-2 text-[11px]">
                <div className="down font-bold">Watchlist changed in another tab</div>
                <div className="dim">Server list: {syncConflict.current.join(", ") || "(empty)"}</div>
                <div className="flex gap-2 mt-2">
                  <button type="button" className="term-btn" onClick={useServerWatchlist}>USE SERVER LIST</button>
                  <button type="button" className="term-btn" onClick={overwriteWatchlist}>OVERWRITE WITH THIS TAB</button>
                </div>
              </section>
            )}
            {syncNotice && <div className="text-[11px] amber">{syncNotice}</div>}

            {unread.length > 0 && (
              <section className="border border-[var(--border)] bg-[var(--panel)] p-2 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="amber font-bold">Unread scanner alerts ({unread.length})</span>
                  <button type="button" className="term-btn ml-auto" onClick={() => markRead.mutate()} disabled={markRead.isPending}>
                    MARK ALL READ
                  </button>
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {unread.slice(0, 12).map((notification) => (
                    <button
                      key={notification.id}
                      type="button"
                      className="border border-[var(--border)] px-2 py-1 hover:border-[var(--amber-dim)]"
                      onClick={() => {
                        setHistoryView(true);
                        setSelectedId(notification.opportunityId);
                      }}
                    >
                      <span className={notification.type === "invalidated" ? "down" : notification.type === "entry_ready" ? "up" : "amber"}>
                        {notification.type.replaceAll("_", " ")}
                      </span>{" "}
                      <span className="dim">{formatDateTime(notification.createdAt)}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="border border-[var(--border)] bg-[var(--panel)]">
              <div className="flex flex-wrap items-center gap-2 p-2 border-b border-[var(--border)]">
                <div className="flex">
                  {(["intraday", "swing"] as Horizon[]).map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      className={`term-btn ${horizon === entry ? "active" : ""}`}
                      onClick={() => setHorizon(entry)}
                    >
                      {entry.toUpperCase()}
                    </button>
                  ))}
                </div>
                <select value={strategy} onChange={(event) => setStrategy(event.target.value)} aria-label="Filter by strategy">
                  <option value="all">All strategies</option>
                  {Object.entries(STRATEGY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} aria-label="Filter by lifecycle state">
                  <option value="all">All states</option>
                  <option value="watching">Watching</option>
                  <option value="entry_ready">Entry ready</option>
                  <option value="invalidated">Invalidated</option>
                  <option value="expired">Expired</option>
                </select>
                <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={pinnedOnly} onChange={(event) => setPinnedOnly(event.target.checked)} className="accent-[var(--amber)]" /> Pinned</label>
                <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={includeDismissed} onChange={(event) => setIncludeDismissed(event.target.checked)} className="accent-[var(--amber)]" /> Dismissed</label>
                <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={historyView} onChange={(event) => setHistoryView(event.target.checked)} className="accent-[var(--amber)]" /> History</label>
                <button type="button" className="term-btn ml-auto" onClick={() => void refresh()}>REFRESH</button>
              </div>

              {opportunitiesQuery.isLoading ? (
                <div className="p-3 dim text-[11px]">Loading opportunities…</div>
              ) : opportunitiesQuery.error ? (
                <div className="p-3 down text-[11px]">{(opportunitiesQuery.error as Error).message}</div>
              ) : empty ? (
                <div className="p-3">
                  <div className="amber text-[12px]">{empty.title}</div>
                  <div className="dim text-[11px] mt-1">{empty.detail}</div>
                </div>
              ) : (
                <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Opportunities">
                  <table className="data-table min-w-[980px]">
                    <thead>
                      <tr>
                        <th>Symbol</th><th>Recipe</th><th>Strategy</th><th>State</th><th>Health</th><th>Expiry</th><th>Max loss</th><th>Legs</th><th>Updated</th><th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((opportunity) => (
                        <tr key={opportunity.id} className={opportunity.archived ? "opacity-50" : ""}>
                          <td>
                            <button type="button" className="font-bold amber hover:underline" onClick={() => setSelectedId(opportunity.id)}>
                              {opportunity.symbol}
                            </button>
                            {opportunity.pinned && <span className="ml-1 amber" title="Pinned">★</span>}
                            {opportunity.dismissed && <span className="ml-1 dim" title="Dismissed">muted</span>}
                          </td>
                          <td className="dim">{opportunity.recipeId}</td>
                          <td>{STRATEGY_LABELS[opportunity.strategy] ?? opportunity.strategy}</td>
                          <td><StateBadge state={opportunity.state} /></td>
                          <td><HealthBadge health={opportunity.currentHealth} /></td>
                          <td>{opportunity.expiry}</td>
                          <td>{formatUsd(opportunity.risk.maxLossUsd)}</td>
                          <td className="dim break-all max-w-[260px]">{legsSummary(opportunity)}</td>
                          <td>{formatDateTime(opportunity.lastCheckedAt ?? opportunity.updatedAt)}</td>
                          <td>
                            <div className="flex gap-1">
                              <button type="button" className="term-btn" onClick={() => pin.mutate({ id: opportunity.id, pinned: !opportunity.pinned })}>
                                {opportunity.pinned ? "UNPIN" : "PIN"}
                              </button>
                              <button type="button" className="term-btn" onClick={() => dismiss.mutate(opportunity.id)} disabled={opportunity.dismissed}>
                                {opportunity.dismissed ? "DISMISSED" : "DISMISS"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {selectedId && (
              <OpportunityDetail
                opportunityId={selectedId}
                onPin={(opportunity, pinned) => pin.mutate({ id: opportunity.id, pinned })}
                onDismiss={(opportunity) => dismiss.mutate(opportunity.id)}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
