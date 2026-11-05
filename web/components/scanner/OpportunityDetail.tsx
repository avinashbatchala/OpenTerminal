"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api";
import {
  STRATEGY_LABELS,
  formatDateTime,
  formatUsd,
  legsSummary,
  type AiAssessment,
  type Opportunity,
  type OpportunityCheck,
  type ScannerEvent,
} from "../../lib/scanner";
import { HealthBadge, StateBadge } from "./StatusBadges";

type DetailPayload = {
  opportunity: Opportunity;
  checks: OpportunityCheck[];
  events: ScannerEvent[];
  assessment: AiAssessment | null;
};

type Props = {
  opportunityId: string;
  onPin: (opportunity: Opportunity, pinned: boolean) => void;
  onDismiss: (opportunity: Opportunity) => void;
  onClose?: () => void;
};

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-[var(--border)] px-2 py-1.5">
      <div className="dim text-[9px] uppercase tracking-wide">{label}</div>
      <div className="mt-0.5 text-[11px]">{value}</div>
    </div>
  );
}

function Level({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number | null;
  tone: "amber" | "down" | "up" | "dim";
  hint: string;
}) {
  const color = tone === "dim" ? "dim" : tone;
  return (
    <div className="rounded border border-[var(--border)] px-2 py-1.5">
      <div className="dim text-[9px] uppercase tracking-wide">{label}</div>
      <div className={`text-[15px] font-bold ${color}`}>
        {value === null || !Number.isFinite(value) ? "—" : value.toFixed(2)}
      </div>
      <div className="mt-0.5 truncate text-[10px] dim" title={hint}>
        {hint}
      </div>
    </div>
  );
}

export default function OpportunityDetail({ opportunityId, onPin, onDismiss, onClose }: Props) {
  const { data, error, isLoading } = useQuery({
    queryKey: ["scanner", "opportunity", opportunityId],
    queryFn: () => apiGet<DetailPayload>(`/api/scanner/opportunities/${encodeURIComponent(opportunityId)}`),
    refetchInterval: 30_000,
    retry: 0,
  });

  if (isLoading) return <div className="scanner-panel p-3 dim text-[11px]">Loading setup detail…</div>;
  if (error) return <div className="scanner-panel p-3 down text-[11px]">{(error as Error).message}</div>;
  if (!data) return null;
  const opportunity = data.opportunity;
  const levels = opportunity.conditions.levels;

  return (
    <section className="scanner-panel">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border)] bg-[var(--panel-2)] px-3 py-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="text-[14px] font-bold amber">
              {opportunity.symbol} · {STRATEGY_LABELS[opportunity.strategy] ?? opportunity.strategy} ·{" "}
              {opportunity.horizon.toUpperCase()}
            </h2>
            <StateBadge state={opportunity.state} />
            <HealthBadge health={opportunity.currentHealth} />
            {opportunity.pinned && <span className="scanner-badge scanner-badge--amber">★ Pinned</span>}
          </div>
          <div className="mt-0.5 text-[10px] dim">
            {opportunity.recipeId} · v{opportunity.recipeVersion} · checked{" "}
            {formatDateTime(opportunity.lastCheckedAt ?? opportunity.updatedAt)}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            className="term-btn"
            onClick={() => onPin(opportunity, !opportunity.pinned)}
            aria-pressed={opportunity.pinned}
          >
            {opportunity.pinned ? "UNPIN" : "PIN"}
          </button>
          <button
            type="button"
            className="term-btn"
            onClick={() => onDismiss(opportunity)}
            disabled={opportunity.dismissed}
          >
            {opportunity.dismissed ? "DISMISSED" : "DISMISS"}
          </button>
          {onClose && (
            <button
              type="button"
              className="term-btn"
              onClick={onClose}
              aria-label="Close setup detail"
              title="Close setup detail"
            >
              ✕
            </button>
          )}
        </div>
      </header>

      <div className="space-y-2 p-2.5 text-[11px]">
        <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
          <Metric label="Lifecycle" value={opportunity.state.replaceAll("_", " ")} />
          <Metric label="Data health" value={opportunity.currentHealth} />
          <Metric label="Expiry" value={opportunity.expiry} />
          <Metric label="Deadline" value={formatDateTime(opportunity.deadline)} />
          <Metric label="Max modeled loss" value={formatUsd(opportunity.risk.maxLossUsd)} />
          <Metric label="Net debit" value={formatUsd(opportunity.risk.netDebitUsd)} />
          <Metric label="Net credit" value={formatUsd(opportunity.risk.netCreditUsd)} />
          <Metric label="AI" value={data.assessment?.status ?? opportunity.aiStatus} />
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <Level label="Entry" value={levels.entry} tone="amber" hint={opportunity.conditions.entry} />
          <Level label="Invalidation" value={levels.invalidation} tone="down" hint={opportunity.conditions.invalidation} />
          <Level
            label="Target"
            value={levels.target}
            tone="up"
            hint={opportunity.conditions.target ?? "No target configured"}
          />
        </div>

        <div className="rounded border border-[var(--border)] p-2">
          <div className="dim text-[9px] uppercase tracking-wide">Thesis / frozen setup</div>
          <div className="mt-0.5">{opportunity.thesis}</div>
          <div className="mt-1 dim">Legs: {legsSummary(opportunity)}</div>
          <div className="dim">
            Signal bar {formatDateTime(opportunity.signal.signalBarTime)} · recipe v{opportunity.recipeVersion} ·{" "}
            {opportunity.signal.barsUsed} completed bars · deadline {formatDateTime(opportunity.conditions.deadline)}
          </div>
          {opportunity.earnings.nextEarningsDate && (
            <div className="amber">Next known earnings: {formatDateTime(opportunity.earnings.nextEarningsDate)}</div>
          )}
        </div>

        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Opportunity legs">
          <table className="data-table min-w-[980px]">
            <thead>
              <tr>
                <th>Side</th>
                <th>Qty</th>
                <th>Symbol</th>
                <th>Expiry</th>
                <th>Type</th>
                <th>Strike</th>
                <th>Bid</th>
                <th>Ask</th>
                <th>Multiplier</th>
                <th>Deliverable</th>
                <th>Quote time</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {opportunity.legs.map((leg) => (
                <tr key={`${leg.contractSymbol}-${leg.side}`}>
                  <td className={leg.side === "buy" ? "up" : "down"}>{leg.side.toUpperCase()}</td>
                  <td>
                    {leg.quantity} ({leg.ratio}:1)
                  </td>
                  <td className="font-bold">{leg.contractSymbol}</td>
                  <td>{leg.expiry}</td>
                  <td>{leg.optionType}</td>
                  <td>{leg.strike}</td>
                  <td>{formatUsd(leg.bid)}</td>
                  <td>{formatUsd(leg.ask)}</td>
                  <td>{leg.multiplier}</td>
                  <td>
                    {leg.deliverable ?? "unverified"}
                    {leg.deliverableSource === "derived" && (
                      <span className="amber"> (derived, not provider-verified)</span>
                    )}
                  </td>
                  <td>{formatDateTime(leg.quoteTime)}</td>
                  <td>{leg.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          <div className="space-y-1 rounded border border-[var(--border)] p-2">
            <div className="dim text-[9px] uppercase tracking-wide">Frozen conditions</div>
            <div>
              <span className="amber">Entry:</span> {opportunity.conditions.entry}
            </div>
            <div>
              <span className="down">Invalidation:</span> {opportunity.conditions.invalidation}
            </div>
            <div>
              <span className="up">Target:</span> {opportunity.conditions.target ?? "None configured"}
            </div>
            <div className="dim">Deadline: {formatDateTime(opportunity.conditions.deadline)}</div>
          </div>
          <div className="space-y-1 rounded border border-[var(--border)] p-2">
            <div className="dim text-[9px] uppercase tracking-wide">Risk assumptions</div>
            <div>
              Fees: {formatUsd(opportunity.risk.feesUsd)} (entry {formatUsd(opportunity.risk.entryFeesUsd)}, exit{" "}
              {formatUsd(opportunity.risk.exitFeesUsd)}, expiry {formatUsd(opportunity.risk.expiryFeesUsd)})
            </div>
            <div>
              {opportunity.risk.slippageScenario.label}: modeled loss{" "}
              {formatUsd(opportunity.risk.slippageScenario.modeledLossUsd)} · not included in the $250 limit.
            </div>
            <ul className="list-disc pl-4 dim">
              {opportunity.risk.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-1 rounded border border-[var(--border)] p-2">
          <div className="dim text-[9px] uppercase tracking-wide">AI assessment</div>
          {data.assessment?.status === "ready" && data.assessment.output ? (
            <>
              <div>
                <span className="amber">
                  Rank {data.assessment.output.rank}/100 · {data.assessment.output.confidence} confidence
                </span>{" "}
                — {data.assessment.output.summary}
              </div>
              <div className="dim">{data.assessment.output.thesis}</div>
              <ul className="list-disc pl-4 dim">
                {data.assessment.output.risks.map((risk) => (
                  <li key={risk}>{risk}</li>
                ))}
              </ul>
              <div className="dim">
                Tokens: {data.assessment.inputTokens ?? "unknown"} in / {data.assessment.outputTokens ?? "unknown"} out
                · estimated cost{" "}
                {data.assessment.estimatedCostUsd === null ? "unknown" : formatUsd(data.assessment.estimatedCostUsd)} ·
                source {data.assessment.pricingSource ?? "unknown"}
              </div>
            </>
          ) : (
            <div className="dim">
              {data.assessment?.error ??
                "Assessment pending or unavailable. Deterministic gates and monitoring are unaffected."}
            </div>
          )}
        </div>

        <details className="rounded border border-[var(--border)]">
          <summary className="scanner-summary">
            Checks and history ({data.checks.length} checks, {data.events.length} events)
          </summary>
          <div className="grid grid-cols-1 gap-2 border-t border-[var(--border)] p-2 xl:grid-cols-2">
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Opportunity checks">
              <table className="data-table min-w-[520px]">
                <thead>
                  <tr>
                    <th>Checked</th>
                    <th>Health</th>
                    <th>Before</th>
                    <th>After</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {data.checks.map((check) => (
                    <tr key={check.id}>
                      <td>{formatDateTime(check.checkedAt)}</td>
                      <td className={check.health === "current" ? "up" : check.health === "stale" ? "amber" : "down"}>
                        {check.health}
                      </td>
                      <td>{check.stateBefore}</td>
                      <td>{check.stateAfter}</td>
                      <td className="dim">{check.note ?? "—"}</td>
                    </tr>
                  ))}
                  {data.checks.length === 0 && (
                    <tr>
                      <td colSpan={5} className="dim">
                        No checks recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Opportunity events">
              <table className="data-table min-w-[420px]">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Time</th>
                    <th>Dedupe key</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((event) => (
                    <tr key={event.id}>
                      <td className={event.type === "invalidated" ? "down" : event.type === "entry_ready" ? "up" : "amber"}>
                        {event.type.replaceAll("_", " ")}
                      </td>
                      <td>{formatDateTime(event.createdAt)}</td>
                      <td className="dim break-all">{event.dedupeKey}</td>
                    </tr>
                  ))}
                  {data.events.length === 0 && (
                    <tr>
                      <td colSpan={3} className="dim">
                        No lifecycle events yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </details>

        <div className="dim text-[10px]">
          This is a hypothetical, modeled setup. No order was placed and no fill, position, or realized P&amp;L is
          implied.
        </div>
      </div>
    </section>
  );
}
