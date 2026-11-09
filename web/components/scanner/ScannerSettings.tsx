"use client";

import { useSyncExternalStore } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../lib/api";
import { formatDateTime, type ScannerStatus } from "../../lib/scanner";
import ScannerConfigPanel from "./ScannerConfigPanel";
import { getScannerSyncNotice, subscribeScannerSync } from "./scannerSyncNotice";

export default function ScannerSettings({ status }: { status: ScannerStatus | undefined }) {
  const queryClient = useQueryClient();
  const notice = useSyncExternalStore(subscribeScannerSync, getScannerSyncNotice, () => null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["scanner"] });

  const decide = useMutation({
    mutationFn: ({ symbol, decision }: { symbol: string; decision: "monitor" | "archive" }) =>
      apiPost("/api/scanner/watchlist/decision", { symbol, decision }),
    onSuccess: refresh,
  });

  const markRead = useMutation({
    mutationFn: () => apiPost("/api/scanner/notifications/read", {}),
    onSuccess: refresh,
  });

  if (!status) {
    return <p className="dim text-[11px]">Scanner status is unavailable.</p>;
  }

  const lastRun = status.lastRun;

  return (
    <div className="scanner-settings">
      {notice && <div className="scanner-note amber">{notice}</div>}

      <section className="scanner-settings-block">
        <h3 className="scanner-settings-title">Status</h3>
        <dl className="scanner-settings-grid">
          <div>
            <dt>Scanner</dt>
            <dd className={status.config.enabled ? "up" : "down"}>
              {status.config.enabled ? "Enabled" : "Paused"}
            </dd>
          </div>
          <div>
            <dt>Readiness</dt>
            <dd className={status.readiness.ready ? "up" : "amber"}>
              {status.readiness.ready ? "Ready" : "Needs configuration"}
            </dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>{status.session.label}</dd>
          </div>
          <div>
            <dt>Last scan</dt>
            <dd>{lastRun ? `${formatDateTime(lastRun.startedAt)}, ${lastRun.status}` : "None yet"}</dd>
          </div>
          <div>
            <dt>Next scan</dt>
            <dd>{status.nextScheduledAt ? formatDateTime(status.nextScheduledAt) : "-"}</dd>
          </div>
          <div>
            <dt>Watchlist</dt>
            <dd>
              {status.config.watchlist.length}/{status.config.maxWatchlistSymbols} symbols
            </dd>
          </div>
        </dl>
      </section>

      {status.readiness.issues.length > 0 && (
        <section className="scanner-settings-block">
          <h3 className="scanner-settings-title">Activation blockers</h3>
          <ul className="scanner-settings-list down">
            {status.readiness.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </section>
      )}

      {status.readiness.warnings.length > 0 && (
        <section className="scanner-settings-block">
          <h3 className="scanner-settings-title">Warnings</h3>
          <ul className="scanner-settings-list amber">
            {status.readiness.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

      {status.pendingWatchlistRemovals.length > 0 && (
        <section className="scanner-settings-block">
          <h3 className="scanner-settings-title">Removed symbols need a decision</h3>
          <p className="dim text-[10.5px]">
            New discovery is stopped for these symbols. Existing setups stay monitored until you choose.
          </p>
          <div className="scanner-settings-actions">
            {status.pendingWatchlistRemovals.map((removal) => (
              <div key={removal.symbol} className="scanner-decision">
                <span className="font-bold">{removal.symbol}</span>
                <span className="dim">{removal.opportunityIds.length} setup(s)</span>
                <button
                  type="button"
                  className="term-btn"
                  onClick={() => decide.mutate({ symbol: removal.symbol, decision: "monitor" })}
                >
                  KEEP
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

      {status.unreadNotifications > 0 && (
        <section className="scanner-settings-block">
          <div className="flex items-center justify-between gap-2">
            <h3 className="scanner-settings-title">{status.unreadNotifications} unread alerts</h3>
            <button
              type="button"
              className="term-btn"
              onClick={() => markRead.mutate()}
              disabled={markRead.isPending}
            >
              MARK ALL READ
            </button>
          </div>
        </section>
      )}

      <section className="scanner-settings-block">
        <h3 className="scanner-settings-title">Configuration &amp; activation</h3>
        <ScannerConfigPanel status={status} />
      </section>

      {lastRun && (
        <details className="scanner-settings-block">
          <summary className="scanner-summary">Last scan diagnostics</summary>
          <div className="scanner-settings-body">
            <div className="dim text-[10.5px]">
              {lastRun.candidates} candidate(s), {lastRun.qualified} qualified, {lastRun.coverage.length}{" "}
              symbol(s) covered
            </div>
            {lastRun.failures.length > 0 && (
              <ul className="scanner-settings-list down">
                {lastRun.failures.map((failure) => (
                  <li key={failure}>{failure}</li>
                ))}
              </ul>
            )}
            {lastRun.coverage.length > 0 && (
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scan coverage">
                <table className="data-table min-w-[420px]">
                  <thead>
                    <tr>
                      <th scope="col">Symbol</th>
                      <th scope="col">Status</th>
                      <th scope="col">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lastRun.coverage.map((entry) => (
                      <tr key={entry.symbol}>
                        <td className="font-bold">{entry.symbol}</td>
                        <td className={entry.status === "scanned" ? "up" : entry.status === "failed" ? "down" : "amber"}>
                          {entry.status}
                        </td>
                        <td className="dim">{entry.reason ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </details>
      )}

      {status.monitoringGaps.length > 0 && (
        <section className="scanner-settings-block">
          <h3 className="scanner-settings-title">Monitoring gaps</h3>
          <ul className="scanner-settings-list amber">
            {status.monitoringGaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
