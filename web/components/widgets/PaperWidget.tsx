"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "../../lib/api";
import { useLiveExecution } from "../../lib/liveExecution";
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
import EquityChart from "../portfolio/EquityChart";
import { Surface } from "../shell/Surface";
import Tag, { type TagTone } from "../ui/Tag";

type Tab = "open" | "history";

function Pnl({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <span className="edge-muted">-</span>;
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
  if (entry === null) return "-";
  return entry >= 0 ? `Debit ${formatUsd(entry)}` : `Credit ${formatUsd(-entry)}`;
}

function exitPremiumLabel(trade: ExecutionTrade): string {
  const summary = trade.exitSummary;
  if (!summary) return "No exit";
  const value = summary.netPricePerShare * (summary.legs[0]?.multiplier ?? 100);
  return value >= 0 ? `Exit debit ${formatUsd(value)}` : `Exit credit ${formatUsd(-value)}`;
}

function statusLabel(status: string): string {
  const label = status.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function statusTone(status: string): TagTone {
  if (status === "open") return "up";
  if (status === "closed") return "neutral";
  if (status === "rejected" || status === "cancelled") return "down";
  return "accent";
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
          {save.isPending ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}

function TradeDetail({
  detail,
  liveMark,
  onClose,
  onCloseTrade,
  closing,
  showDone = true,
}: {
  detail: ExecutionDetail;
  liveMark: ExecutionMark | null;
  onClose: () => void;
  onCloseTrade: () => void;
  closing: boolean;
  showDone?: boolean;
}) {
  const trade = detail.trade;
  const latestMark: ExecutionMark | null = liveMark ?? detail.marks[0] ?? null;

  return (
    <div className="paper-detail">
      <div className="paper-detail-head">
        <div>
          <span className="paper-detail-symbol">{trade.symbol}</span>
          <span className="dim">
            {" "}
            , {STRATEGY_LABELS[trade.strategy] ?? trade.strategy}, {trade.horizon}
          </span>
          <div className="dim text-[10px]">
            Opened {trade.openedAt ? formatDateTime(trade.openedAt) : "-"}
            {trade.closedAt ? `, Closed ${formatDateTime(trade.closedAt)}` : ""}
          </div>
        </div>
        <span className="flex items-center gap-2">
          <Tag tone={statusTone(trade.status)}>{statusLabel(trade.status)}</Tag>
          {trade.status === "open" && (
            <button type="button" className="term-btn" onClick={onCloseTrade} disabled={closing}>
              {closing ? "Closing…" : "Close"}
            </button>
          )}
        </span>
      </div>

      {latestMark && (
        <div className="paper-mark-note dim">
          Marked {formatDateTime(latestMark.markedAt)}
          {latestMark.underlyingPrice !== null
            ? `, underlying ${formatUsd(latestMark.underlyingPrice)}`
            : ""}
        </div>
      )}

      <div className="paper-detail-metrics">
        <Metric label="Entry" value={premiumLabel(trade)} />
        <Metric
          label="Exit"
          value={
            trade.exitSummary
              ? trade.exitSummary.netPricePerShare >= 0
                ? `Debit ${formatUsd(trade.exitSummary.netPricePerShare * (trade.exitSummary.legs[0]?.multiplier ?? 100))}`
                : `Credit ${formatUsd(-trade.exitSummary.netPricePerShare * (trade.exitSummary.legs[0]?.multiplier ?? 100))}`
              : "-"
          }
        />
        <Metric label="Mark" value={latestMark ? formatUsd(latestMark.liquidationValueUsd) : "-"} />
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
        <table className="data-table min-w-[560px]">
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
                <td data-label="Side" className={fill.side === "buy" ? "up" : "down"}>
                  {fill.side.charAt(0).toUpperCase() + fill.side.slice(1)}
                </td>
                <td data-label="Contract">{fill.contractSymbol}</td>
                <td data-label="Qty">{fill.quantity}</td>
                <td data-label="Price">{formatUsd(fill.price)}</td>
                <td data-label="Mid">{formatUsd(fill.referenceMid)}</td>
                <td data-label="Slip">{formatUsd(fill.slippageUsd)}</td>
                <td data-label="Fees">{formatUsd(fill.feesUsd)}</td>
                <td data-label="Time">{formatDateTime(fill.filledAt)}</td>
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

      {showDone && (
        <div className="paper-detail-actions">
          <button type="button" className="term-btn" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

export default function PaperWidget() {
  const queryClient = useQueryClient();
  const liveExecution = useLiveExecution();
  const [tab, setTab] = useState<Tab>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    queryKey: ["execution", "status"],
    queryFn: () => apiGet<ExecutionStatus>("/api/execution/status", { timeoutMs: 8_000 }),
    refetchInterval: 10_000,
    retry: 0,
  });
  const tradesQuery = useQuery({
    queryKey: ["execution", "trades"],
    queryFn: () => apiGet<ExecutionTrade[]>("/api/execution/trades?limit=200", { timeoutMs: 8_000 }),
    refetchInterval: 10_000,
    retry: 0,
  });
  const equityQuery = useQuery({
    queryKey: ["execution", "equity"],
    queryFn: () => apiGet<EquityPayload>("/api/execution/equity?limit=200", { timeoutMs: 8_000 }),
    refetchInterval: 30_000,
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
  const trades = useMemo(() => tradesQuery.data ?? [], [tradesQuery.data]);
  const openTrades = useMemo(
    () =>
      trades
        .filter((trade) => ["pending_entry", "open", "pending_exit"].includes(trade.status))
        .sort(
          (a, b) =>
            Date.parse(b.openedAt ?? b.createdAt) - Date.parse(a.openedAt ?? a.createdAt)
        ),
    [trades]
  );
  const closedTrades = useMemo(
    () => trades.filter((trade) => trade.status === "closed"),
    [trades]
  );
  const historyTrades = useMemo(
    () =>
      trades
        .filter((trade) => ["closed", "rejected", "cancelled"].includes(trade.status))
        .sort(
          (a, b) =>
            Date.parse(b.closedAt ?? b.updatedAt) - Date.parse(a.closedAt ?? a.updatedAt)
        ),
    [trades]
  );
  const visible = tab === "open" ? openTrades : historyTrades;
  const history = equityQuery.data?.history ?? [];
  const equity: EquitySnapshot | null =
    liveExecution.equity ?? equityQuery.data?.latest ?? status?.equity ?? null;
  const dayChange = dayChangeUsd(
    equity ? [equity, ...history.filter((row) => row.asOf !== equity.asOf)] : history
  );
  const realized = closedTrades.reduce((sum, trade) => sum + (trade.pnl?.netUsd ?? 0), 0);

  const selected = trades.find((trade) => trade.id === selectedId) ?? null;
  const selectedMark = selected
    ? liveExecution.marks[selected.id] ?? status?.latestMarks?.[selected.id] ?? null
    : null;

  useEffect(() => {
    if (isMobile) return;
    if (selectedId && visible.some((trade) => trade.id === selectedId)) return;
    setSelectedId(visible[0]?.id ?? null);
  }, [isMobile, selectedId, visible]);

  const changeTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    setSelectedId(null);
  };

  const moveSelection = (direction: 1 | -1) => {
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("[data-trade]") ?? []
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

  const liveTone: TagTone = !liveExecution.connected
    ? "neutral"
    : liveExecution.live.streaming
      ? "up"
      : "accent";
  const liveLabel = !liveExecution.connected
    ? "Marks offline"
    : liveExecution.live.streaming
      ? "Live marks"
      : "Polling marks";

  const detailContent = selected ? (
    detailQuery.isLoading ? (
      <p className="dim text-[12px]">Loading trade…</p>
    ) : detailQuery.error ? (
      <p className="down text-[12px]">{(detailQuery.error as Error).message}</p>
    ) : detailQuery.data ? (
      <TradeDetail
        detail={detailQuery.data}
        liveMark={selectedMark}
        onClose={() => setSelectedId(null)}
        onCloseTrade={() => closeTrade.mutate(selected.id)}
        closing={closeTrade.isPending}
        showDone={isMobile}
      />
    ) : null
  ) : null;

  const row = (trade: ExecutionTrade) => {
    const mark = liveExecution.marks[trade.id] ?? status?.latestMarks?.[trade.id] ?? null;
    const pnl = trade.status === "closed" ? trade.pnl?.netUsd ?? null : unrealizedUsd(trade, mark);
    const when =
      trade.status === "closed"
        ? trade.closedAt
          ? `Closed ${formatDateTime(trade.closedAt)}`
          : `Updated ${formatDateTime(trade.updatedAt)}`
        : trade.openedAt
          ? `Opened ${formatDateTime(trade.openedAt)}`
          : "Pending entry";

    return (
      <button
        key={trade.id}
        type="button"
        data-trade="true"
        data-active={selectedId === trade.id}
        aria-current={selectedId === trade.id ? "true" : undefined}
        className="edge-portfolio-row"
        onClick={() => setSelectedId(trade.id)}
      >
        <span className="edge-portfolio-row-main">
          <span className="edge-portfolio-row-top">
            <span className="edge-portfolio-symbol">{trade.symbol}</span>
            <Tag tone={statusTone(trade.status)}>{statusLabel(trade.status)}</Tag>
            <span className="edge-portfolio-row-sub">
              {STRATEGY_LABELS[trade.strategy] ?? trade.strategy}, {trade.horizon}
            </span>
          </span>
          <span className="edge-portfolio-row-meta">
            <span>{premiumLabel(trade)}</span>
            {trade.status === "closed" ? (
              <span>{exitPremiumLabel(trade)}</span>
            ) : (
              <span>Mark {mark ? formatUsd(mark.liquidationValueUsd) : "-"}</span>
            )}
          </span>
        </span>

        <span className="edge-portfolio-row-figures">
          <span className="edge-portfolio-figure">
            <span className="edge-portfolio-figure-label">
              {trade.status === "closed" ? "Realized" : "Unrealized"}
            </span>
            <span className="edge-portfolio-figure-value">
              <Pnl value={pnl} />
            </span>
          </span>
          <span className="edge-portfolio-figure">
            <span className="edge-portfolio-figure-label">Time</span>
            <span className="edge-portfolio-figure-time">{when}</span>
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="edge-portfolio">
      <section className="edge-portfolio-band">
        <div className="edge-portfolio-band-id">
          <div className="edge-portfolio-band-line">
            <Tag tone={config?.enabled ? "up" : "neutral"}>
              {config?.enabled ? "Auto" : "Paused"}
            </Tag>
            {config && (
              <span className="edge-muted">
                entries {config.automation.entries ? "on" : "off"}, exits{" "}
                {config.automation.exits ? "on" : "off"}
              </span>
            )}
            <Tag tone={liveTone}>{liveLabel}</Tag>
            <span className="edge-muted">
              {liveExecution.live.lastMarkAt
                ? `Marked ${formatDateTime(liveExecution.live.lastMarkAt)}`
                : "Awaiting first mark"}
            </span>
          </div>

          <div className="edge-portfolio-equity">
            <span className="edge-portfolio-equity-label">Equity</span>
            <strong className="edge-portfolio-equity-value">
              {formatUsd(equity?.equityUsd ?? null)}
            </strong>
            <span className="edge-portfolio-equity-change">
              <Pnl value={dayChange} />
              <span className="edge-muted">today</span>
            </span>
          </div>

          <dl className="edge-portfolio-stats">
            <div>
              <dt>Realized</dt>
              <dd>
                <Pnl value={realized} />
              </dd>
            </div>
            <div>
              <dt>Open</dt>
              <dd>{status?.counts.open ?? openTrades.length}</dd>
            </div>
            <div>
              <dt>Cash</dt>
              <dd>{formatUsd(equity?.cashUsd ?? null)}</dd>
            </div>
            <div>
              <dt>Positions</dt>
              <dd>{formatUsd(equity?.positionsUsd ?? null)}</dd>
            </div>
            <div>
              <dt>Starting cash</dt>
              <dd>{formatUsd(config?.startingCashUsd ?? null)}</dd>
            </div>
          </dl>
        </div>

        <div className="edge-portfolio-band-actions">
          <button type="button" className="edge-btn" onClick={() => void invalidate()}>
            Refresh
          </button>
          <button
            type="button"
            className="edge-btn"
            onClick={() => toggle.mutate(!config?.enabled)}
            disabled={!config || toggle.isPending}
          >
            {toggle.isPending ? "Working…" : config?.enabled ? "Pause" : "Start"}
          </button>
          <button
            type="button"
            className="edge-btn"
            onClick={() => setSettingsOpen(true)}
            disabled={!config}
          >
            Settings
          </button>
        </div>
      </section>

      <div className="edge-portfolio-main">
        <div className="edge-portfolio-left">
          <Surface
            flush
            className="edge-portfolio-chart"
            title="Equity curve"
            sub="Paper account"
            action={
              <span className="edge-portfolio-chart-value">
                {formatUsd(equity?.equityUsd ?? null)}
              </span>
            }
          >
            <EquityChart history={history} latest={equity} />
          </Surface>

          <Surface
            flush
            className="edge-portfolio-positions"
            title={tab === "open" ? "Positions" : "History"}
            sub={`${visible.length} ${tab === "open" ? "open" : "in history"}`}
            action={
              <div className="scanner-tabs" role="group" aria-label="Paper trading view">
                <button
                  type="button"
                  className="scanner-tab"
                  data-active={tab === "open"}
                  aria-pressed={tab === "open"}
                  onClick={() => changeTab("open")}
                >
                  Positions {openTrades.length}
                </button>
                <button
                  type="button"
                  className="scanner-tab"
                  data-active={tab === "history"}
                  aria-pressed={tab === "history"}
                  onClick={() => changeTab("history")}
                >
                  History {historyTrades.length}
                </button>
              </div>
            }
            bodyClassName="edge-portfolio-positions-body"
          >
            {statusQuery.error ? (
              <div className="edge-empty down">{(statusQuery.error as Error).message}</div>
            ) : tradesQuery.isLoading ? (
              <div className="edge-empty">Loading paper trades…</div>
            ) : visible.length === 0 ? (
              <div className="edge-empty">
                <div className="amber font-bold">
                  {tab === "open" ? "No open paper trades" : "No closed paper trades"}
                </div>
                <div className="edge-muted">
                  {tab === "open"
                    ? "Enable auto entries in settings, or use Paper on an entry-ready setup."
                    : "Realized P&L appears here after exits."}
                </div>
              </div>
            ) : (
              <div className="edge-portfolio-list" ref={listRef} onKeyDown={onListKeyDown}>
                {visible.map(row)}
              </div>
            )}
          </Surface>
        </div>

        {!isMobile && (
          <aside className="edge-portfolio-detail" role="region" aria-label="Trade detail">
            {detailContent ?? (
              <div className="edge-portfolio-detail-empty">
                <div className="edge-empty">
                  Select a position to inspect the fills, marks and lifecycle.
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {isMobile && selected && (
        <ScannerOverlay
          title="Trade detail"
          variant="side"
          onClose={() => setSelectedId(null)}
        >
          {detailContent}
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
