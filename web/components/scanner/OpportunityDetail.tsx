"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api";
import {
  deadlineStatus,
  executionLevels,
  expiryLabel,
  legRows,
  packageSummary,
  setupInsights,
  signalHighlights,
  stateLabel,
  tradeAction,
  type Insight,
} from "../../lib/opportunityInsight";
import {
  STRATEGY_LABELS,
  formatDateTime,
  formatUsd,
  type AiAssessment,
  type Opportunity,
  type OpportunityCheck,
  type ScannerEvent,
} from "../../lib/scanner";
import { HealthBadge, StateBadge } from "./StatusBadges";
import Tag from "../ui/Tag";

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
  paperTrade?: { id: string; status: string } | null;
  paperPending?: boolean;
  paperError?: string | null;
  onPaperTrade?: () => void;
  onClosePaper?: () => void;
};

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="detail-section">
      <header className="detail-section-head">
        <h3 className="detail-section-title">{title}</h3>
        {hint ? <span className="detail-section-hint">{hint}</span> : null}
      </header>
      <div className="detail-section-body">{children}</div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="detail-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function InsightList({
  items,
  empty,
}: {
  items: Insight[];
  empty: string;
}) {
  if (items.length === 0) return <p className="detail-empty">{empty}</p>;
  return (
    <ul className="insight-list">
      {items.map((item) => (
        <li key={item.text} data-tone={item.tone}>
          <span className="insight-marker" aria-hidden="true" />
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

export default function OpportunityDetail({
  opportunityId,
  onPin,
  onDismiss,
  onClose,
  paperTrade = null,
  paperPending = false,
  paperError = null,
  onPaperTrade,
  onClosePaper,
}: Props) {
  const { data, error, isLoading } = useQuery({
    queryKey: ["scanner", "opportunity", opportunityId],
    queryFn: () =>
      apiGet<DetailPayload>(`/api/scanner/opportunities/${encodeURIComponent(opportunityId)}`),
    refetchInterval: 30_000,
    retry: 0,
  });

  if (isLoading) return <div className="scanner-panel p-3 dim text-[11px]">Loading setup detail…</div>;
  if (error) return <div className="scanner-panel p-3 down text-[11px]">{(error as Error).message}</div>;
  if (!data) return null;

  const opportunity = data.opportunity;
  const action = tradeAction(opportunity);
  const deadline = deadlineStatus(opportunity.deadline);
  const levels = executionLevels(opportunity);
  const highlights = signalHighlights(opportunity);
  const insights = setupInsights(opportunity, data.assessment);
  const legs = legRows(opportunity);
  const packagePrice = packageSummary(opportunity);
  const strategy = STRATEGY_LABELS[opportunity.strategy] ?? opportunity.strategy;

  return (
    <section className="scanner-panel">
      <header className="detail-head">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="text-[14px] font-bold amber">
              {opportunity.symbol}, {strategy}, {opportunity.horizon}
            </h2>
            <StateBadge state={opportunity.state} />
            <HealthBadge health={opportunity.currentHealth} />
            {opportunity.pinned && <Tag tone="accent">Pinned</Tag>}
          </div>
          <div className="mt-0.5 text-[10px] dim">
            {opportunity.recipeId}, v{opportunity.recipeVersion}, signal{" "}
            {formatDateTime(opportunity.signal.signalBarTime)}, checked{" "}
            {formatDateTime(opportunity.lastCheckedAt ?? opportunity.updatedAt)}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {onPaperTrade && !paperTrade && (
            <button
              type="button"
              className="term-btn term-btn--primary"
              onClick={onPaperTrade}
              disabled={paperPending}
            >
              {paperPending ? "Entering…" : "Paper"}
            </button>
          )}
          {paperTrade?.status === "open" && onClosePaper && (
            <button type="button" className="term-btn" onClick={onClosePaper} disabled={paperPending}>
              {paperPending ? "Closing…" : "Close paper"}
            </button>
          )}
          {paperTrade && paperTrade.status !== "open" && (
            <Tag tone={paperTrade.status === "closed" ? "neutral" : "accent"}>
              Paper {paperTrade.status.replaceAll("_", " ")}
            </Tag>
          )}
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

      <div className="detail-body">
        {paperError && <div className="paper-error">{paperError}</div>}
        <div className="action-card" data-tone={action.tone}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="action-kicker">{action.title}</div>
              <div className="action-directive">{action.directive}</div>
              <p className="action-detail">{action.detail}</p>
            </div>
            <div className="action-deadline">
              <span className="kicker">Deadline</span>
              <span className={`action-deadline-value ${deadline.tone}`}>{deadline.label}</span>
              <span className="dim text-[10px]">{formatDateTime(opportunity.deadline)}</span>
            </div>
          </div>
          <div className="action-meta">
            <span>
              Lifecycle <span className="text-[var(--text)]">{stateLabel(opportunity)}</span>
            </span>
            <span>
              Horizon <span className="text-[var(--text)]">{opportunity.horizon}</span>
            </span>
            <span>
              Data <span className={opportunity.currentHealth === "current" ? "up" : "amber"}>{opportunity.currentHealth}</span>
            </span>
            <span>
              Expiry <span className="text-[var(--text)]">{expiryLabel(opportunity.expiry)}</span>
            </span>
          </div>
        </div>

        <div className="level-grid">
          {levels.map((level) => (
            <div key={level.label} className="level-tile" data-tone={level.tone} title={level.hint}>
              <span className="level-label">{level.label}</span>
              <span className={`level-value ${level.tone}`}>{level.value}</span>
              <span className="level-hint">{level.hint}</span>
            </div>
          ))}
        </div>

        <Section title="Why it's in play" hint={`${opportunity.recipeId}, ${opportunity.recipeVersion}`}>
          <p className="detail-thesis">{opportunity.thesis}</p>
          {highlights.length > 0 && (
            <dl className="signal-grid">
              {highlights.map((highlight) => (
                <div key={highlight.label} className="signal-item">
                  <dt>{highlight.label}</dt>
                  <dd>{highlight.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <dl className="fact-grid">
            <Fact label="Signal bar">{formatDateTime(opportunity.signal.signalBarTime)}</Fact>
            <Fact label="Bars used">
              {opportunity.signal.barsUsed} completed{" "}
              {opportunity.horizon === "intraday" ? "five-minute" : "daily"} bars
            </Fact>
            <Fact label="Earnings">
              {opportunity.earnings.checked
                ? opportunity.earnings.nextEarningsDate
                  ? formatDateTime(opportunity.earnings.nextEarningsDate)
                  : "None before deadline"
                : "Unavailable"}
            </Fact>
            <Fact label="Signal source">{opportunity.signal.source}</Fact>
            <Fact label="Config revision">{opportunity.configRevision}</Fact>
          </dl>
        </Section>

        <Section
          title="Trade construction"
          hint={`${legs.length} leg${legs.length === 1 ? "" : "s"}, ${expiryLabel(opportunity.expiry)}`}
        >
          <div className="trade-summary">
            <div className="trade-summary-item">
              <span className="kicker">{packagePrice.label}</span>
              <span className="trade-summary-value">{formatUsd(packagePrice.totalUsd)}</span>
              <span className="dim text-[10px]">
                {packagePrice.perShare === null ? "per-share unavailable" : `${formatUsd(packagePrice.perShare)}/share`}
              </span>
            </div>
            <div className="trade-summary-item">
              <span className="kicker">Max modeled loss</span>
              <span className="trade-summary-value down">{formatUsd(opportunity.risk.maxLossUsd)}</span>
              <span className="dim text-[10px]">fees included</span>
            </div>
            <div className="trade-summary-item">
              <span className="kicker">Fees</span>
              <span className="trade-summary-value">{formatUsd(opportunity.risk.feesUsd)}</span>
              <span className="dim text-[10px]">entry + exit + expiry</span>
            </div>
            <div className="trade-summary-item">
              <span className="kicker">{opportunity.risk.widthUsd === null ? "Contracts" : "Width"}</span>
              <span className="trade-summary-value">
                {opportunity.risk.widthUsd === null
                  ? opportunity.risk.contracts
                  : formatUsd(opportunity.risk.widthUsd)}
              </span>
              <span className="dim text-[10px]">
                {opportunity.risk.widthUsd === null ? "one strategy unit" : `${opportunity.risk.contracts} contract(s)`}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto detail-table-wrap" tabIndex={0} role="region" aria-label="Opportunity legs">
            <table className="data-table min-w-[640px]">
              <caption className="sr-only">Option legs for this setup</caption>
              <thead>
                <tr>
                  <th scope="col">Side</th>
                  <th scope="col">Contract</th>
                  <th scope="col">Strike</th>
                  <th scope="col">Bid</th>
                  <th scope="col">Ask</th>
                  <th scope="col">Mid</th>
                  <th scope="col">Qty</th>
                </tr>
              </thead>
              <tbody>
                {legs.map((leg) => (
                  <tr key={leg.key}>
                    <td>
                      <span className={`leg-side ${leg.side === "buy" ? "up" : "down"}`}>
                        {leg.side === "buy" ? "BUY" : "SELL"}
                      </span>
                    </td>
                    <td className="leg-contract">
                      <span className="leg-contract-label">{leg.contract}</span>
                      <span className="leg-symbol">{leg.contractSymbol}</span>
                    </td>
                    <td>{leg.strike}</td>
                    <td>{formatUsd(leg.bid)}</td>
                    <td>{formatUsd(leg.ask)}</td>
                    <td>{formatUsd(leg.mid)}</td>
                    <td>
                      {leg.quantity} <span className="dim">({leg.ratio}:1)</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="detail-disclosure">
            <summary className="scanner-summary">Quote provenance</summary>
            <div className="overflow-x-auto detail-table-wrap" tabIndex={0} role="region" aria-label="Quote provenance">
              <table className="data-table min-w-[560px]">
                <thead>
                  <tr>
                    <th scope="col">Leg</th>
                    <th scope="col">Multiplier</th>
                    <th scope="col">Deliverable</th>
                    <th scope="col">Quote time</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {opportunity.legs.map((leg, index) => (
                    <tr key={`${leg.contractSymbol}-${leg.side}-provenance`}>
                      <td>
                        {index + 1}. {leg.side} {leg.optionType}
                      </td>
                      <td>{leg.multiplier}</td>
                      <td>
                        {leg.deliverable ?? "unverified"}
                        {leg.deliverableSource === "derived" && (
                          <span className="amber"> (derived)</span>
                        )}
                      </td>
                      <td>{formatDateTime(leg.quoteTime)}</td>
                      <td>{leg.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Section>

        <Section title="Risk & reward" hint="Deterministic gates, not advice">
          <div className="insight-columns">
            <div>
              <h4 className="insight-heading up">Supports the setup</h4>
              <InsightList items={insights.supports} empty="No supporting evidence recorded." />
            </div>
            <div>
              <h4 className="insight-heading amber">Watch before acting</h4>
              <InsightList items={insights.watches} empty="No open warnings from the stored checks." />
            </div>
          </div>

          <details className="detail-disclosure">
            <summary className="scanner-summary">Risk assumptions &amp; slippage</summary>
            <div className="detail-disclosure-body">
              <p>
                <span className="amber">Slippage:</span> {opportunity.risk.slippageScenario.label}, modeled
                loss {formatUsd(opportunity.risk.slippageScenario.modeledLossUsd)}. Slippage is shown separately
                and is not part of the risk limit.
              </p>
              <ul className="list-disc pl-4 dim">
                {opportunity.risk.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </div>
          </details>
        </Section>

        <Section title="AI review" hint={data.assessment?.status ?? opportunity.aiStatus}>
          {data.assessment?.status === "ready" && data.assessment.output ? (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone="accent">Rank {data.assessment.output.rank}/100</Tag>
                <Tag>{data.assessment.output.confidence} confidence</Tag>
              </div>
              <p>{data.assessment.output.summary}</p>
              <p className="dim">{data.assessment.output.thesis}</p>
              <ul className="list-disc pl-4 dim">
                {data.assessment.output.risks.map((risk) => (
                  <li key={risk}>{risk}</li>
                ))}
              </ul>
              <p className="dim">
                Tokens: {data.assessment.inputTokens ?? "unknown"} in /{" "}
                {data.assessment.outputTokens ?? "unknown"} out, estimated cost{" "}
                {data.assessment.estimatedCostUsd === null
                  ? "unknown"
                  : formatUsd(data.assessment.estimatedCostUsd)}{" "}
                , source {data.assessment.pricingSource ?? "unknown"}
              </p>
            </div>
          ) : (
            <p className="dim">
              {data.assessment?.error ??
                "Assessment pending or unavailable. Deterministic gates and monitoring are unaffected."}
            </p>
          )}
        </Section>

        <details className="detail-disclosure">
          <summary className="scanner-summary">
            Checks and history ({data.checks.length} checks, {data.events.length} events)
          </summary>
          <div className="grid grid-cols-1 gap-2 border-t border-[var(--border)] p-2 xl:grid-cols-2">
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Opportunity checks">
              <table className="data-table min-w-[520px]">
                <thead>
                  <tr>
                    <th scope="col">Checked</th>
                    <th scope="col">Health</th>
                    <th scope="col">Before</th>
                    <th scope="col">After</th>
                    <th scope="col">Note</th>
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
                      <td className="dim">{check.note ?? "-"}</td>
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
                    <th scope="col">Event</th>
                    <th scope="col">Time</th>
                    <th scope="col">Dedupe key</th>
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

        <p className="detail-footnote">
          Hypothetical, modeled setup. No order was placed and no fill, position, or realized P&amp;L is implied.
        </p>
      </div>
    </section>
  );
}
