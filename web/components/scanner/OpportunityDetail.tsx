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
};

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border border-[var(--border)] p-1.5">
      <div className="dim text-[9px] uppercase tracking-wide">{label}</div>
      <div className="text-[11px]">{value}</div>
    </div>
  );
}

export default function OpportunityDetail({ opportunityId, onPin, onDismiss }: Props) {
  const { data, error, isLoading } = useQuery({
    queryKey: ["scanner", "opportunity", opportunityId],
    queryFn: () => apiGet<DetailPayload>(`/api/scanner/opportunities/${encodeURIComponent(opportunityId)}`),
    refetchInterval: 30_000,
    retry: 0,
  });

  if (isLoading) return <div className="p-2 dim text-[11px]">Loading setup detail…</div>;
  if (error) return <div className="p-2 down text-[11px]">{(error as Error).message}</div>;
  if (!data) return null;
  const opportunity = data.opportunity;

  return (
    <section className="border border-[var(--border)] bg-[var(--panel)]">
      <div className="panel-title cursor-default">
        <span>
          {opportunity.symbol} · {STRATEGY_LABELS[opportunity.strategy] ?? opportunity.strategy} ·{" "}
          {opportunity.horizon.toUpperCase()}
        </span>
        <span className="flex gap-2">
          <button
            type="button"
            className="term-btn"
            onClick={() => onPin(opportunity, !opportunity.pinned)}
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
        </span>
      </div>
      <div className="p-2 space-y-2 text-[11px]">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
          <Metric label="Lifecycle" value={opportunity.state.replace("_", " ")} />
          <Metric label="Data health" value={opportunity.currentHealth} />
          <Metric label="Expiry" value={opportunity.expiry} />
          <Metric label="Deadline" value={formatDateTime(opportunity.deadline)} />
          <Metric label="Max modeled loss" value={formatUsd(opportunity.risk.maxLossUsd)} />
          <Metric label="Net debit" value={formatUsd(opportunity.risk.netDebitUsd)} />
          <Metric label="Net credit" value={formatUsd(opportunity.risk.netCreditUsd)} />
          <Metric label="AI" value={data.assessment?.status ?? opportunity.aiStatus} />
        </div>

        <div className="border border-[var(--border)] p-2">
          <div className="dim text-[9px] uppercase tracking-wide">Draft thesis / frozen setup</div>
          <div>{opportunity.thesis}</div>
          <div className="dim mt-1">Legs: {legsSummary(opportunity)}</div>
          <div className="dim">Signal bar: {formatDateTime(opportunity.signal.signalBarTime)} · Recipe v{opportunity.recipeVersion} · {opportunity.signal.barsUsed} completed bars</div>
          {opportunity.earnings.nextEarningsDate && (
            <div className="dim">Next known earnings: {formatDateTime(opportunity.earnings.nextEarningsDate)}</div>
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
                  <td>{leg.quantity} ({leg.ratio}:1)</td>
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          <div className="border border-[var(--border)] p-2 space-y-1">
            <div className="dim text-[9px] uppercase tracking-wide">Frozen conditions</div>
            <div><span className="amber">Entry:</span> {opportunity.conditions.entry}</div>
            <div><span className="amber">Invalidation:</span> {opportunity.conditions.invalidation}</div>
            <div><span className="amber">Target:</span> {opportunity.conditions.target ?? "None configured"}</div>
            <div className="dim">Deadline: {formatDateTime(opportunity.conditions.deadline)}</div>
          </div>
          <div className="border border-[var(--border)] p-2 space-y-1">
            <div className="dim text-[9px] uppercase tracking-wide">Risk assumptions</div>
            <div>Fees: {formatUsd(opportunity.risk.feesUsd)} (entry {formatUsd(opportunity.risk.entryFeesUsd)}, exit {formatUsd(opportunity.risk.exitFeesUsd)}, expiry {formatUsd(opportunity.risk.expiryFeesUsd)})</div>
            <div>{opportunity.risk.slippageScenario.label}: modeled loss {formatUsd(opportunity.risk.slippageScenario.modeledLossUsd)} · not included in the $250 limit.</div>
            <ul className="list-disc pl-4 dim">
              {opportunity.risk.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
            </ul>
          </div>
        </div>

        <div className="border border-[var(--border)] p-2 space-y-1">
          <div className="dim text-[9px] uppercase tracking-wide">AI assessment</div>
          {data.assessment?.status === "ready" && data.assessment.output ? (
            <>
              <div><span className="amber">Rank {data.assessment.output.rank}/100 · {data.assessment.output.confidence} confidence</span> — {data.assessment.output.summary}</div>
              <div className="dim">{data.assessment.output.thesis}</div>
              <ul className="list-disc pl-4 dim">
                {data.assessment.output.risks.map((risk) => <li key={risk}>{risk}</li>)}
              </ul>
              <div className="dim">Tokens: {data.assessment.inputTokens ?? "unknown"} in / {data.assessment.outputTokens ?? "unknown"} out · estimated cost {data.assessment.estimatedCostUsd === null ? "unknown" : formatUsd(data.assessment.estimatedCostUsd)} · source {data.assessment.pricingSource ?? "unknown"}</div>
            </>
          ) : (
            <div className="dim">
              {data.assessment?.error ?? "Assessment pending or unavailable. Deterministic gates and monitoring are unaffected."}
            </div>
          )}
        </div>

        <details className="border border-[var(--border)] p-2" open>
          <summary className="cursor-pointer dim text-[9px] uppercase tracking-wide">
            Checks and history ({data.checks.length} checks, {data.events.length} events)
          </summary>
          <div className="mt-2 grid grid-cols-1 xl:grid-cols-2 gap-2">
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Opportunity checks">
              <table className="data-table min-w-[520px]">
                <thead><tr><th>Checked</th><th>Health</th><th>Before</th><th>After</th><th>Note</th></tr></thead>
                <tbody>
                  {data.checks.map((check) => (
                    <tr key={check.id}>
                      <td>{formatDateTime(check.checkedAt)}</td>
                      <td className={check.health === "current" ? "up" : check.health === "stale" ? "amber" : "down"}>{check.health}</td>
                      <td>{check.stateBefore}</td>
                      <td>{check.stateAfter}</td>
                      <td className="dim">{check.note ?? "—"}</td>
                    </tr>
                  ))}
                  {data.checks.length === 0 && <tr><td colSpan={5} className="dim">No checks recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Opportunity events">
              <table className="data-table min-w-[420px]">
                <thead><tr><th>Event</th><th>Time</th><th>Dedupe key</th></tr></thead>
                <tbody>
                  {data.events.map((event) => (
                    <tr key={event.id}>
                      <td className={event.type === "invalidated" ? "down" : event.type === "entry_ready" ? "up" : "amber"}>{event.type.replaceAll("_", " ")}</td>
                      <td>{formatDateTime(event.createdAt)}</td>
                      <td className="dim break-all">{event.dedupeKey}</td>
                    </tr>
                  ))}
                  {data.events.length === 0 && <tr><td colSpan={3} className="dim">No lifecycle events yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="dim text-[10px] mt-2">
            This is a hypothetical, modeled setup. No order was placed and no fill, position, or realized P&amp;L is implied.
          </div>
        </details>
      </div>
    </section>
  );
}
