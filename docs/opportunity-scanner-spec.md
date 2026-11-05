# Opportunity scanner — product specification

Status: discovery draft. Confirmed decisions are distinguished from proposed
behavior and unresolved configuration. This document does not enable scanning.

## Confirmed product decisions

- Discover options opportunities from the user's watchlist.
- Separate intraday and swing opportunities on a dedicated Opportunities page.
- Add a terminal badge for new in-app alerts.
- Support long calls/puts, debit spreads, credit spreads, and iron condors.
  Exclude covered calls and cash-secured puts from version one.
- Require maximum modeled loss of $250 per complete setup, including quantity
  and all legs. This is a screening constraint, not a realized-loss guarantee.
- Require configured fee assumptions before enablement; include those fees in
  the $250 modeled-loss filter. Define which entry/exit/expiry charges the model
  includes and display them. Show slippage as a separately labeled scenario,
  not as a guaranteed bound or silently included estimate.
- Evaluate one contract for single-leg ideas or one complete strategy unit for
  spreads/condors, preserving leg ratios. Reject units exceeding $250; do not
  increase quantities to consume the remaining risk allowance.
- Explicit signal and liquidity rules generate candidates. AI explains and ranks
  qualified candidates; it cannot override eligibility or risk limits.
- Include trend/breakout, mean-reversion, and volatility-based signal families.
  Exact measurable recipes and thresholds still need definition.
- Run scans approximately every five minutes during regular US market hours.
- Automatically monitor every qualifying setup. Allow pinning and dismissal.
- Notify on discovery, entry conditions being met, and invalidation. Unchanged
  scans do not repeat notifications.
- Evaluate new or materially changed candidates with AI. Show usage and estimated
  cost without imposing a spending cap.
- Intraday and swing expiry ranges must be configured before scanning starts.
- Default swing deadline is the start of the option's expiry-day regular session;
  a recipe may specify an earlier deadline. Unsupported expiry/session mappings
  require an explicit resolution rather than silently extending monitoring.
- Draft a small, versioned recipe set for user review before activation. The
  proposed recipes live in [opportunity-recipes-v1.md](opportunity-recipes-v1.md).
- Removing a watchlist symbol prompts whether to keep monitoring existing setups.
  Proposed pending-choice behavior: stop new discovery, retain existing monitoring,
  and show the unresolved decision; do not silently archive existing setups.
- Exclude setups spanning known earnings events. Hold candidates when required
  data is missing, stale, or unverified.
- Expire intraday setups at that day's regular-session close, including shortened
  sessions. Expiry ends setup monitoring; it does not imply a position was closed.
- Dismissal permanently mutes alerts for that setup while preserving its history
  and checks. Only a genuinely new setup can alert again.
- After an entry condition has been observed, record subsequent predefined target
  observations as history events and continue checks until invalidation or expiry.
  A target observation is not a fill, realized return, or an additional alert type.

## Proposed experience

The page shows scanner enabled/paused state, current session, last completed scan,
next scheduled scan, data health, scan coverage, and AI usage/estimated cost.
Its primary tabs are Intraday and Swing. Filters include strategy, setup state,
pinned, dismissed, and historical opportunities.

Each opportunity displays symbol, strategy, expiry, exact legs and quantities,
observed bid/ask and quote timestamps/sources, proposed limit clearly labeled as
an estimate, maximum modeled loss, entry conditions, invalidation conditions,
last successful check, and a concise explanation of what changed.

Opening a setup reveals its original evidence, current evidence, chronological
checks and state changes, risk assumptions, and AI assessment. Keep the original
thesis and legs immutable within a setup revision. Changed legs create a linked
replacement rather than silently rewriting the original opportunity.

Empty states distinguish no qualifying opportunities from incomplete coverage,
unconfigured settings, a closed market, and unavailable providers/AI.

## Proposed setup lifecycle

- Watching: qualified setup exists; entry conditions have not been met.
- Entry ready: the same setup meets its explicit entry conditions on verified
  data. This does not indicate a trade or fill.
- Invalidated: an explicit invalidation rule was met.
- Expired: its time/session/contract deadline passed.

Track data health separately: current, stale, or unable to assess. Missing data
must not imply continued validity or cause a thesis-based invalidation.
Pinning and dismissal are user preferences, not evidence of a position.

Confirmed: intraday setups expire at their regular-session close. Dismissal mutes
that setup permanently, without deleting its history or stopping its checks.
Repeated scans, AI wording changes, and small price movements must not evade a
dismissal by creating a new identity.

Proposed policy requiring confirmation: invalidated/expired setups are terminal;
a genuinely new signal creates a linked successor. Define new-signal identity and
re-alert eligibility explicitly. The product does not infer trades, positions,
fills, or P&L.

## Proposed scan pipeline

1. Check explicit enablement, required configuration, and an exchange calendar
   with New York time, daylight-saving changes, holidays, and shortened sessions.
2. Snapshot the configured watchlist and recipe/configuration revision.
3. Fetch bounded market data through existing market services/routes, preserving
   provider fallbacks, caches, rate limits, and public/Schwab selection.
4. Check timestamps, quote coherence, earnings coverage, liquidity, and required
   indicators. Report held/excluded symbols and reasons.
5. Apply versioned deterministic signal rules; construct supported contracts,
   quantities, and legs; validate payoff bounds and total modeled risk. Reject
   unsupported contract adjustments or multipliers until explicitly supported.
6. Match setup identities across scans. Recheck all active monitored setups,
   including ones that no longer pass discovery screening.
7. Ask AI to explain/rank new or materially changed eligible setups using a
   validated structured schema. Record evidence and model/prompt versions.
   AI failure must remain visible; retain deterministic monitoring results.
8. Commit checks, state transitions, and deduplicated alert events transactionally.

The existing chat Markdown response is not a scanner persistence contract. Reuse
the AI client configuration and bounded execution infrastructure, but separate
scanner output validation and prompts from conversational presentation. AI tools
remain read-only; the scanner service owns database writes.

Define material changes explicitly: signal changes, meaningful quote/risk changes,
eligibility changes, and setup state transitions. Thresholds remain unresolved.
Repeated quotes, scan timestamps, or cosmetic AI wording do not create new setups.

## Proposed persistence and runtime

Extend the existing better-sqlite3 WAL database rather than adding another store.
Use versioned, additive schema changes consistent with repository startup.

Logical records:
- Scanner configuration: enablement, watchlist snapshot/revision, expiry ranges,
  recipes, liquidity/data freshness thresholds, and configuration version.
- Scan runs: scheduled/start/end times, status, coverage, failures, and counts.
- Opportunities: stable identity, strategy/horizon, exact legs, immutable original
  evidence, current lifecycle state, deadlines, and user preferences.
- Checks/events: observed data, rule evaluations, health, state transitions,
  linked revisions, and AI assessments.
- Notifications: unique event identity, read state, and delivery state.
- AI usage: model, actual reported token usage, estimate inputs/pricing version,
  and estimated cost; display unknown costs honestly.

Implement scheduling in the API process, independent of browser tabs. The API must
remain running. Prevent overlapping runs and use a database lease if multiple API
instances can access the same database. Bound concurrency, retries, and timeouts.
After restart/sleep, recover interrupted runs and perform a current-session check;
do not replay a backlog of historical scans or invent missed state transitions.
Record monitoring gaps. No background AI calls before explicit enablement.

The browser's watchlist currently lives in persisted Zustand state. The server
needs an authenticated, explicit synchronization contract; it cannot read browser
localStorage. Persist the scanner's last synchronized universe and show its sync
status. Define edits/removals separately from monitoring existing opportunities.

Use authenticated scanner routes through the existing Next proxy. Keep credentials
server-side. Data-source/configuration changes must not commit results using an
obsolete configuration revision. No orders, brokerage account reads, or execution.

## Acceptance tests

- No scanning until enabled and required configuration is valid.
- Correct session eligibility across holidays, shortened sessions, and DST.
- No duplicate/overlapping runs, including recovery after process interruption.
- Risk and eligibility checks for each supported strategy, quantities, contract
  multipliers, missing/crossed/stale quotes, earnings uncertainty, and $250 limits.
- Missing data produces unable-to-assess health, not a valid/invalid signal.
- Identical scans preserve setup identity and do not repeat alerts or AI calls.
- Monitored setups continue receiving checks even after discovery filters fail.
- Entry/invalidation/expiry events and user preferences behave consistently.
- Configured fees are required and included in the risk limit; quantities stay
  at one complete unit; slippage scenarios are labeled separately.
- Target observations after entry readiness are deduplicated history events and
  do not terminate monitoring or imply an executed trade.
- Intraday setups expire at the correct session close even when the final scan
  was missed; recovery records the deadline without inventing intermediate checks.
- Dismissed setups do not re-alert on rescans or cosmetic revisions; successor
  alerts require the explicit new-setup identity rule.
- AI malformed output, refusal, timeout, and provider failures are recorded without
  bypassing deterministic checks or corrupting prior history.
- Configuration/source changes and late results cannot mix evidence revisions.
- Authenticated watchlist sync, persistence, and multi-tab behavior are explicit.
- Page tests cover tabs, detail history, pin/dismiss, unread alerts, loading,
  incomplete coverage, degraded health, keyboard access, and narrow layouts.
- Automated tests mock providers/models and use isolated SQLite databases.
  Separately evaluate real model explanations and real provider quote quality.

## Remaining product decisions

1. Signal recipes and their configurable thresholds; liquidity and quote-age
   requirements. No profitability assumptions or hardcoded trading preferences.
2. Any overnight holding assumptions used in swing modeling. The confirmed swing
   deadline is expiry-day session open, unless a recipe ends earlier.
3. Exact target definitions and fee-model components/values required at setup.
4. The precise definition of a genuinely new setup and terminal-state policy.
5. Slippage scenario inputs and permitted contract types/multipliers. Fee values
   remain required configuration; missing values must block enablement.
6. History retention, archived alert handling, and visible monitoring/AI workload.

Implementation should follow a concrete recipe contract and confirmed lifecycle
policy. Resolve these before enabling autonomous opportunity generation.
