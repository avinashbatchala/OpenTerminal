"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "../../lib/api";
import {
  dayChangeUsd,
  entryPremiumUsd,
  unrealizedUsd,
  type EquityPayload,
  type EquitySnapshot,
  type ExecutionConfig,
  type ExecutionDetail,
  type ExecutionMark,
  type ExecutionStatus,
  type ExecutionTrade,
} from "../../lib/paper";
import { STRATEGY_LABELS, formatDateTime, formatUsd } from "../../lib/scanner";
import ScannerOverlay from "../scanner/ScannerOverlay";

type Tab = "open" | "closed";

function Pnl({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <span className="dim">—</span>;
  return (
    <span className={value >= 0 ? "up" : "down"}>
      {value >= 0 ? "+" : ""}
      {formatUsd(value)}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="paper-metric">
      <span className="paper-metric-label">{label}</span>
      <span className="paper-metric-value">{value}</span>
    </div>
  );
}

function premiumLabel(trade: ExecutionTrade): string {
  const entry = entryPremiumUsd(trade);
  if (entry === null) return "—";
  return entry >= 0 ? `Debit ${formatUsd(entry)}` : `Credit ${formatUsd(-entry)}`;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="paper-field">
      <span>
        <span className="paper-field-label">{label}</span>
        {hint ? <span className="paper-field-hint">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function PaperSettings({
  config,
  onSaved,
}: {
  config: ExecutionConfig;
  onSaved: (config: ExecutionConfig) => void;
}) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [entries, setEntries] = useState(config.automation.entries);
  const [exits, setExits] = useState(config.automation.exits);
  const [profitPct, setProfitPct] = useState(config.exits.profitTargetFraction * 100);
  const [stopMultiple, setStopMultiple] = useState(config.exits.stopLossFraction);
  const [timeStop, setTimeStop] = useState(
    config.exits.timeStopMinutes === null ? "" : String(config.exits.timeStopMinutes)
  );
  const [spreadFactor, setSpreadFactor] = useState(config.slippage.spreadFactor);
  const [maxSlip, setMaxSlip] = useState(config.slippage.maxSlippagePct);
  const [maxOpen, setMaxOpen] = useState(config.limits.maxOpenTrades);
  const [maxSymbol, setMaxSymbol] = useState(config.limits.maxPerSymbol);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      apiPut<{ config: ExecutionConfig }>("/api/execution/config", {
        enabled,
        automation: { entries, exits },
        exits: {
          profitTargetFraction: profitPct / 100,
          stopLossFraction: stopMultiple,
          timeStopMinutes: timeStop.trim() === "" ? null : Number(timeStop),
        },
        slippage: { spreadFactor, maxSlippagePct: maxSlip },
        limits: { maxOpenTrades: maxOpen, maxPerSymbol: maxSymbol },
      }),
    onSuccess: (data) => {
      setError(null);
      setSaved(true);
      onSaved(data.config);
    },
    onError: (mutationError: Error) => {
      setSaved(false);
      setError(mutationError.message);
    },
  });

  return (
    <div className="paper-settings">
      <label className="paper-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>Automation enabled</span>
        <span className="dim">Starts entries/exits on the next 30s tick</span>
      </label>

      <div className="paper-settings-grid">
        <label className="paper-toggle">
          <input
            type="checkbox"
            checked={entries}
            onChange={(event) => setEntries(event.target.checked)}
          />
          <span>Auto entries</span>
        </label>
        <label className="paper-toggle">
          <input
            type="checkbox"
            checked={exits}
            onChange={(event) => setExits(event.target.checked)}
          />
          <span>Auto exits</span>
        </label>
      </div>

      <h3 className="paper-section-title">Exit rules</h3>
      <div className="paper-settings-grid">
        <Field label="Profit target" hint="% of premium / credit">
          <input
            type="number"
            min={5}
            max={200}
            step={5}
            value={profitPct}
            onChange={(event) => setProfitPct(Number(event.target.value))}
          />
        </Field>
        <Field label="Stop loss" hint="× premium / credit">
          <input
            type="number"
            min={0.1}
            max={5}
            step={0.1}
            value={stopMultiple}
            onChange={(event) => setStopMultiple(Number(event.target.value))}
          />
        </Field>
        <Field label="Time stop" hint="minutes, blank = off">
          <input
            type="number"
            min={1}
            step={1}
            value={timeStop}
            onChange={(event) => setTimeStop(event.target.value)}
            placeholder="off"
          />
        </Field>
      </div>

      <h3 className="paper-section-title">Execution model</h3>
      <div className="paper-settings-grid">
        <Field label="Spread crossed" hint="1 = pay full spread">
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={spreadFactor}
            onChange={(event) => setSpreadFactor(Number(event.target.value))}
          />
        </Field>
        <Field label="Max slippage" hint="% of mid">
          <input
            type="number"
            min={0.1}
            max={100}
            step={1}
            value={maxSlip}
            onChange={(event) => setMaxSlip(Number(event.target.value))}
          />
        </Field>
      </div>

      <h3 className="paper-section-title">Risk limits</h3>
      <div className="paper-settings-grid">
        <Field label="Max open trades">
          <input
            type="number"
            min={1}
            max={100}
            value={maxOpen}
            onChange={(event) => setMaxOpen(Number(event.target.value))}
          />
        </Field>
        <Field label="Max per symbol">
          <input
            type="number"
            min={1}
            max={20}
            value={maxSymbol}
            onChange={(event) => setMaxSymbol(Number(event.target.value))}
          />
        </Field>
      </div>

      <p className="dim text-[10px]">
        Starting cash is fixed when the API process starts. All orders are simulated.
      </p>

      {error ? <div className="paper-error">{error}</div> : null}
      {saved && !save.isPending ? <div className="paper-saved">Settings saved.</div> : null}

      <div className="paper-settings-actions">
        <button
          type="button"
          className="term-btn term-btn--primary"
          onClick={() => save.mutate()}
          disabled={save.isPending}
        >
          {save.isPending ? "SAVING…" : "SAVE SETTINGS"}
        </button>
      </div>
    </div>
  );
}

function TradeDetail({
  detail,
  onClose,
  onCloseTrade,
  closing,
}: {
  detail: ExecutionDetail;
  onClose: () => void;
  onCloseTrade: () => void;
  closing: boolean;
}) {
  const trade = detail.trade;
  const latestMark: ExecutionMark | null = detail.marks[0] ?? null;

  return (
    <div className="paper-detail">
      <div className="paper-detail-head">
        <div>
          <span className="paper-detail-symbol">{trade.symbol}</span>
          <span className="dim">
            {" "}
            · {STRATEGY_LABELS[trade.strategy] ?? trade.strategy} · {trade.horizon}
          </span>
          <div className="dim text-[10px]">
            Opened {trade.openedAt ? formatDateTime(trade.openedAt) : "—"}
            {trade.closedAt ? ` · Closed ${formatDateTime(trade.closedAt)}` : ""}
          </div>
        </div>
        <span
          className={`scanner-badge ${
            trade.status === "open"
              ? "scanner-badge--up"
              : trade.status === "closed"
                ? "scanner-badge--muted"
                : "scanner-badge--amber"
          }`}
        >
          {trade.status.replaceAll("_", " ")}
        </span>
      </div>

      <div className="paper-detail-metrics">
        <Metric label="Entry" value={premiumLabel(trade)} />
        <Metric
          label="Exit"
          value={
            trade.exitSummary
              ? trade.exitSummary.netPricePerShare >= 0
                ? `Debit ${formatUsd(trade.exitSummary.netPricePerShare * (trade.exitSummary.legs[0]?.multiplier ?? 100))}`
                : `Credit ${formatUsd(-trade.exitSummary.netPricePerShare * (trade.exitSummary.legs[0]?.multiplier ?? 100))}`
              : "—"
          }
        />
        <Metric label="Mark" value={latestMark ? formatUsd(latestMark.liquidationValueUsd) : "—"} />
        <Metric
          label={trade.status === "closed" ? "Realized" : "Unrealized"}
          value={
            trade.status === "closed" ? (
              <Pnl value={trade.pnl?.netUsd ?? null} />
            ) : (
              <Pnl value={unrealizedUsd(trade, latestMark)} />
            )
          }
        />
        <Metric
          label="Fees"
          value={formatUsd((trade.entrySummary?.feesUsd ?? 0) + (trade.exitSummary?.feesUsd ?? 0))}
        />
        <Metric
          label="Slippage"
          value={formatUsd(
            (trade.entrySummary?.slippageUsd ?? 0) + (trade.exitSummary?.slippageUsd ?? 0)
          )}
        />
      </div>

      <h3 className="paper-section-title">Fills</h3>
      <div className="paper-table-wrap" tabIndex={0} role="region" aria-label="Paper fills">
        <table className="data-table min-w-[620px]">
          <thead>
            <tr>
              <th scope="col">Side</th>
              <th scope="col">Contract</th>
              <th scope="col">Qty</th>
              <th scope="col">Price</th>
              <th scope="col">Mid</th>
              <th scope="col">Slip</th>
              <th scope="col">Fees</th>
              <th scope="col">Time</th>
            </tr>
          </thead>
          <tbody>
            {detail.fills.map((fill) => (
              <tr key={fill.fillId}>
                <td className={fill.side === "buy" ? "up" : "down"}>{fill.side.toUpperCase()}</td>
                <td>{fill.contractSymbol}</td>
                <td>{fill.quantity}</td>
                <td>{formatUsd(fill.price)}</td>
                <td>{formatUsd(fill.referenceMid)}</td>
                <td>{formatUsd(fill.slippageUsd)}</td>
                <td>{formatUsd(fill.feesUsd)}</td>
                <td>{formatDateTime(fill.filledAt)}</td>
              </tr>
            ))}
            {detail.fills.length === 0 && (
              <tr>
                <td colSpan={8} className="dim">
                  No fills recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 className="paper-section-title">Lifecycle</h3>
      <ul className="paper-events">
        {detail.events.map((event) => (
          <li key={event.id}>
            <span className="paper-event-type">{event.type.replaceAll("_", " ")}</span>
            <span className="dim">{formatDateTime(event.createdAt)}</span>
            {typeof event.payload.reason === "object" && event.payload.reason !== null ? (
              <span className="amber">
                {String((event.payload.reason as { kind?: string }).kind ?? "")}
              </span>
            ) : null}
          </li>
        ))}
        {detail.events.length === 0 && <li className="dim">No events yet.</li>}
      </ul>

      <div className="paper-detail-actions">
        {trade.status === "open" && (
          <button type="button" className="term-btn" onClick={onCloseTrade} disabled={closing}>
            {closing ? "CLOSING…" : "CLOSE TRADE"}
          </button>
        )}
        <button type="button" className="term-btn" onClick={onClose}>
          CLOSE DETAIL
        </button>
      </div>
    </div>
  );
}

export default function PaperWidget() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["execution", "status"],
    queryFn: () => apiGet<ExecutionStatus>("/api/execution/status", { timeoutMs: 8_000 }),
    refetchInterval: 30_000,
    retry: 0,
  });
  const tradesQuery = useQuery({
    queryKey: ["execution", "trades"],
    queryFn: () => apiGet<ExecutionTrade[]>("/api/execution/trades?limit=200", { timeoutMs: 8_000 }),
    refetchInterval: 30_000,
    retry: 0,
  });
  const equityQuery = useQuery({
    queryKey: ["execution", "equity"],
    queryFn: () => apiGet<EquityPayload>("/api/execution/equity?limit=200", { timeoutMs: 8_000 }),
    refetchInterval: 60_000,
    retry: 0,
  });
  const detailQuery = useQuery({
    queryKey: ["execution", "trade", selectedId],
    enabled: selectedId !== null,
    queryFn: () =>
      apiGet<ExecutionDetail>(`/api/execution/trades/${encodeURIComponent(selectedId ?? "")}`, {
        timeoutMs: 8_000,
      }),
    retry: 0,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["execution"] });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => apiPut("/api/execution/config", { enabled }),
    onSuccess: invalidate,
  });
  const closeTrade = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/api/execution/trades/${encodeURIComponent(id)}/close`, {}),
    onSuccess: async () => {
      await invalidate();
      await detailQuery.refetch();
    },
  });

  const status = statusQuery.data;
  const config = status?.config;
  const trades = tradesQuery.data ?? [];
  const openTrades = trades.filter((trade) =>
    ["pending_entry", "open", "pending_exit"].includes(trade.status)
  );
  const closedTrades = trades.filter((trade) => trade.status === "closed");
  const historyTrades = trades.filter((trade) =>
    ["closed", "rejected", "cancelled"].includes(trade.status)
  );
  const equity: EquitySnapshot | null = equityQuery.data?.latest ?? status?.equity ?? null;
  const dayChange = dayChangeUsd(equityQuery.data?.history ?? []);
  const realized = closedTrades.reduce((sum, trade) => sum + (trade.pnl?.netUsd ?? 0), 0);

  return (
    <div className="paper-widget">
      <header className="paper-head">
        <div className="paper-head-row">
          <span
            className={`scanner-badge ${
              config?.enabled ? "scanner-badge--up" : "scanner-badge--muted"
            }`}
          >
            {config?.enabled ? "● AUTO" : "○ PAUSED"}
          </span>
          {config && (
            <span className="dim">
              entries {config.automation.entries ? "on" : "off"} · exits{" "}
              {config.automation.exits ? "on" : "off"}
            </span>
          )}
          <span className="paper-head-actions">
            <button type="button" className="term-btn" onClick={() => void invalidate()}>
              REFRESH
            </button>
            <button
              type="button"
              className="term-btn"
              onClick={() => toggle.mutate(!config?.enabled)}
              disabled={!config || toggle.isPending}
            >
              {config?.enabled ? "PAUSE" : "START"}
            </button>
            <button
              type="button"
              className="term-btn"
              onClick={() => setSettingsOpen(true)}
              disabled={!config}
            >
              SETTINGS
            </button>
          </span>
        </div>

        <div className="paper-metrics">
          <Metric label="Equity" value={formatUsd(equity?.equityUsd ?? null)} />
          <Metric label="Day P&L" value={<Pnl value={dayChange} />} />
          <Metric label="Realized" value={<Pnl value={realized} />} />
          <Metric label="Open" value={String(status?.counts.open ?? openTrades.length)} />
        </div>

        <div className="paper-head-row">
          <div className="scanner-tabs" role="group" aria-label="Paper trading view">
            <button
              type="button"
              className="scanner-tab"
              data-active={tab === "open"}
              aria-pressed={tab === "open"}
              onClick={() => setTab("open")}
            >
              POSITIONS {openTrades.length}
            </button>
            <button
              type="button"
              className="scanner-tab"
              data-active={tab === "closed"}
              aria-pressed={tab === "closed"}
              onClick={() => setTab("closed")}
            >
              HISTORY {historyTrades.length}
            </button>
          </div>
          <span className="dim text-[10px]">
            {statusQuery.isFetching || tradesQuery.isFetching ? "updating…" : "30s automation"}
          </span>
        </div>
      </header>

      {statusQuery.error ? (
        <div className="paper-empty down">{(statusQuery.error as Error).message}</div>
      ) : tradesQuery.isLoading ? (
        <div className="paper-empty dim">Loading paper trades…</div>
      ) : tab === "open" ? (
        openTrades.length === 0 ? (
          <div className="paper-empty">
            <div className="amber font-bold">No open paper trades</div>
            <div className="dim">
              Enable auto entries in settings, or use PAPER on an entry-ready setup.
            </div>
          </div>
        ) : (
          <div className="paper-list">
            {openTrades.map((trade) => {
              const mark = status?.latestMarks?.[trade.id] ?? null;
              const pnl = unrealizedUsd(trade, mark);
              return (
                <button
                  key={trade.id}
                  type="button"
                  className="scanner-card paper-row"
                  data-selected={selectedId === trade.id}
                  onClick={() => setSelectedId(trade.id)}
                >
                  <span className="paper-row-main">
                    <span className="paper-row-top">
                      <span className="paper-symbol">{trade.symbol}</span>
                      <span
                        className={`scanner-badge ${
                          trade.status === "open" ? "scanner-badge--up" : "scanner-badge--amber"
                        }`}
                      >
                        {trade.status.replaceAll("_", " ")}
                      </span>
                      <span className="dim text-[10px]">
                        {STRATEGY_LABELS[trade.strategy] ?? trade.strategy} · {trade.horizon}
                      </span>
                    </span>
                    <span className="paper-row-meta">
                      {premiumLabel(trade)} · Mark{" "}
                      {mark ? formatUsd(mark.liquidationValueUsd) : "—"}
                    </span>
                  </span>
                  <span className="paper-row-side">
                    <Pnl value={pnl} />
                    <span className="dim text-[9px]">
                      {trade.openedAt ? formatDateTime(trade.openedAt) : "pending"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )
      ) : closedTrades.length === 0 ? (
        <div className="paper-empty">
          <div className="amber font-bold">No closed paper trades</div>
          <div className="dim">Realized P&L appears here after exits.</div>
        </div>
      ) : (
        <div className="paper-list">
          {closedTrades.map((trade) => (
            <button
              key={trade.id}
              type="button"
              className="scanner-card paper-row"
              data-selected={selectedId === trade.id}
              onClick={() => setSelectedId(trade.id)}
            >
              <span className="paper-row-main">
                <span className="paper-row-top">
                  <span className="paper-symbol">{trade.symbol}</span>
                  <span
                    className={`scanner-badge ${
                      trade.status === "closed" ? "scanner-badge--muted" : "scanner-badge--amber"
                    }`}
                  >
                    {trade.status}
                  </span>
                  <span className="dim text-[10px]">
                    {STRATEGY_LABELS[trade.strategy] ?? trade.strategy} · {trade.horizon}
                  </span>
                </span>
                <span className="paper-row-meta">
                  Fees {formatUsd(trade.pnl?.feesUsd ?? null)} ·{" "}
                  {trade.closedAt
                    ? `Closed ${formatDateTime(trade.closedAt)}`
                    : `Updated ${formatDateTime(trade.updatedAt)}`}
                </span>
              </span>
              <span className="paper-row-side">
                {trade.status === "closed" ? (
                  <>
                    <Pnl value={trade.pnl?.netUsd ?? null} />
                    <span className="dim text-[9px]">net P&amp;L</span>
                  </>
                ) : (
                  <span className="dim text-[9px]">no fill</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {selectedId && (
        <ScannerOverlay title="Paper trade" onClose={() => setSelectedId(null)}>
          {detailQuery.isLoading ? (
            <p className="dim text-[11px]">Loading trade…</p>
          ) : detailQuery.error ? (
            <p className="down text-[11px]">{(detailQuery.error as Error).message}</p>
          ) : detailQuery.data ? (
            <TradeDetail
              detail={detailQuery.data}
              onClose={() => setSelectedId(null)}
              onCloseTrade={() => closeTrade.mutate(selectedId)}
              closing={closeTrade.isPending}
            />
          ) : null}
        </ScannerOverlay>
      )}

      {settingsOpen && config && (
        <ScannerOverlay
          title="Paper trading settings"
          onClose={() => setSettingsOpen(false)}
          wide
        >
          <PaperSettings
            config={config}
            onSaved={() => {
              void invalidate();
            }}
          />
        </ScannerOverlay>
      )}
    </div>
  );
}
