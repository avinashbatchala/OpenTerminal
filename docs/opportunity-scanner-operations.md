# Opportunity scanner — setup, operation, and recovery

Status: implemented, **disabled by default**, not activated by this change. This
document describes operation and the remaining review items; it is not a claim
of model compliance, provider completeness, or trading performance.

## Where it lives

- UI: `/opportunities` (also linked from the terminal top bar with an unread
  alert badge).
- API: `/api/scanner/*`, authenticated through the existing shared key and
  reached from the browser only through the Next proxy.
- Runtime: an in-process scheduler in the Express API. No external scheduler,
  second database, or browser-driven scanning is used.
- Storage: additive `scanner_*` tables in the existing SQLite WAL database.
  Migrations are versioned by `scanner_schema_migrations`.

## Default state

The scanner is **disabled** and every recipe is disabled with unapproved draft
parameters. Opening the page synchronizes the browser watchlist to the server,
but does not start a scan and does not make a paid AI call.

## Activation checklist

All of the following must be explicitly accepted on `/opportunities` before
activation succeeds:

1. Fee assumptions: per-order, entry/contract, exit/contract, and expiry/contract.
2. Intraday and swing expiry ranges.
3. Quote age, inter-leg skew, bid/ask width, volume, and open-interest limits.
4. Contract-selection and bounded strike/expiry policy, including the
   separately displayed slippage scenario.
5. The provider-history assumption. Completed bars are treated as raw provider
   data; adjusted-data consistency is not independently verified.
6. At least one recipe enabled, its version accepted, and its parameters
   approved. Each recipe can be enabled independently.
7. A nonempty synchronized watchlist (a warning, not an activation blocker).

AI configuration is optional for deterministic discovery and monitoring. If AI
is unavailable, assessments remain visibly unavailable or failed; eligibility
and lifecycle are unaffected.

## Operation

- The scheduler checks roughly every 30 seconds and starts a scan at most about
  every five minutes during a verified regular US session.
- Sessions use `America/New_York`, DST conversion, US exchange holidays, and
  known shortened sessions. If calendar evaluation fails, session eligibility
  is unavailable and scanning does not run.
- Only the synchronized server watchlist is used for new discovery. Existing
  active setups continue receiving checks even if they no longer pass discovery
  filters.
- Intraday deadlines are the signal day's regular-session close. Swing
  deadlines are the regular-session open on expiry day.
- A database lease prevents overlapping runs, including across multiple API
  instances sharing the database.
- A run captures its configuration revision before fetching. If configuration,
  watchlist revision, or the public/Schwab data-source toggle changes before
  commit, the run is marked obsolete and its collected results are discarded.
- Restart recovery marks in-flight runs interrupted, records a monitoring gap,
  expires passed deadlines without inventing intermediate checks, and lets the
  next current-session run proceed. It does not replay paid scans. A gap is also
  recorded once when the scheduler resumes after a missed cycle (process sleep,
  laptop suspend, or downtime) and the last completed run is older than one
  scan interval.

## Watchlist synchronization

The browser sends its Zustand watchlist with the last server watchlist revision.
A revision conflict returns `409` and the UI asks the user to use the server
list or explicitly overwrite it. Removing a symbol stops new discovery but
keeps existing setups monitored with `pending` watchlist decision until the user
chooses “keep monitoring” or “archive”.

## Lifecycle and identity

Proposed policies currently implemented:

- Stable identity = recipe/version + symbol + horizon + direction + strategy +
  signal-bar time + exact contracts/legs.
- Quote-only changes do not create a new identity or a new alert. Alternative
  strikes within the same signal share a mute key and inherit dismissal.
- Invalidated and expired states are terminal. A genuinely new signal (new
  signal-bar time) creates a new setup; a recent terminal setup in the same
  family is linked as `predecessor_id`.
- Dismissal mutes future notifications for that setup and its contract
  revisions while checks and history continue. A new signal can alert again.
- Target observations after entry readiness are history events, not fills and
  not additional alert types.
- Pinning and watchlist decisions are preferences, not evidence of a position.

The terminal/successor policy and re-arm rule require product review before
autonomous alerts are treated as final.

## Contract selection and risk (proposed, deterministic)

1. Pick the listed expiry inside the configured horizon range whose days-to-expiry
   is closest to the range midpoint; break ties by earlier expiry, then ISO date.
2. Take at most `maxStrikesPerSide` strikes within `maxStrikeDistancePct` of the
   frozen signal-bar close, nearest first.
3. For directional ideas, choose the expiry-band strike nearest
   `targetStrikeDistancePct`, then one protective/opposing strike inside the
   configured width range, preferring the width midpoint and then liquidity.
4. For credit ideas, place short strikes beyond the frozen range or invalidation
   level with `shortBufferPct`, then one wing inside the configured width range.
   Strikes are ordered put-long, put-short, call-short, call-long for an iron
   condor.
5. Reject the package when any leg lacks a verified multiplier/deliverable,
   fresh timestamped bid/ask, liquidity, or coherent inter-leg timing. Do not
   search for a cheaper alternative merely to pass the $250 limit; a rejected
   package is held, and the reason is shown in coverage.
6. Modeled loss uses the observed ask for buys and bid for sells, one complete
   unit, standard 100 multiplier, entry + exit + expiry fee assumptions, and
   cent rounding (positive half-up). Slippage is a separately labeled scenario
   and never part of the risk-limit test.

## Data limitations

- Public option chains may omit adjusted-contract metadata. When provider
  metadata is absent, a standard OCC identifier and multiplier of 100 are
  treated as a derived standard 100-share deliverable, visibly marked as
  derived. Non-100 or explicitly non-standard contracts are held.
- Current option IV alone is not treated as elevated historical IV. ATM IV
  observations are persisted with tenor/moneyness/source/time. Volatility
  recipes remain warming up until the configured distinct-day count, lookback,
  freshness, and tenor requirements are met. Realized volatility is never
  substituted for IV rank.
- Scanner chain requests ask the market route for a provider that exposes
  exchange quote timestamps (`requireQuotes=1`). NASDAQ display expiries such as
  `Nov 4` are normalized to ISO dates. Providers without option timestamps are
  skipped for scanner use; retrieval time is never relabeled as quote time. If
  no provider can supply timestamps, candidates are held rather than qualified.
- AI assessments run for new candidates and for candidates whose pending status
  has not been resolved. Frozen legs, levels, and risk are not rewritten by
  rechecks, so quote-only movement does not trigger new paid assessments; a
  materially different setup is a new identity.
- Earnings exclusion requires a successful earnings-calendar response. Missing
  coverage holds discovery; a successful response with no known event is
  treated as no known event.
- Missing, stale, crossed, skewed, illiquid, or unverified required data
  produces “unable to assess”/held status, not “still valid.”
- The $250 figure is a modeled expiration payoff under explicit fees and
  assumptions. Slippage is shown separately and is not included in the limit.
  No trade, fill, position, or realized P&L is inferred.
- AI token usage comes from the SDK response. Estimated cost is present only
  when a pricing source/version and rates are configured; otherwise it remains
  visibly unknown. No spending cap is imposed.

## Manual validation and paper-observation checklist

Run only with explicit authorization and a configured API key. Automated tests
mock providers and models and make no real network or paid AI calls.

- [ ] Activate with a representative watchlist and confirm the first run is
      visible, bounded, and does not overlap a second run.
- [ ] Observe a stock-only long call/put idea with exact legs, risk, and fresh
      timestamps.
- [ ] Observe a debit spread and confirm quantity ratios, width, and debit.
- [ ] Observe a credit spread and confirm net credit, debit/credit labeling,
      and modeled loss including fees.
- [ ] Observe an iron condor and confirm ordered strikes, protective wings,
      max wing width, and net credit.
- [ ] Force stale/crossed/missing quotes and confirm held/unable states.
- [ ] Confirm a missing earnings calendar holds discovery.
- [ ] Confirm IV recipes stay warming until enough distinct days exist; other
      recipes continue.
- [ ] Close/reopen the page and confirm history, alerts, and filters persist.
- [ ] Remove a watchlist symbol and confirm the pending monitoring choice.
- [ ] Restart the API during a run and confirm interrupted/gap/deadline
      reconciliation without replay.
- [ ] Confirm keyboard navigation, focus visibility, wide-table overflow, and
      narrow-screen behavior.
- [ ] Evaluate real model explanations separately from deterministic eligibility
      and record malformed/refusal/timeout behavior.

## Automated coverage

Automated tests cover activation blockers, session/calendar boundaries,
indicator warm-up and recipe signals, contract/risk boundaries, option metadata
handling, identity/dedupe/dismissal, watchlist conflicts, persistence and
recovery, lease/overlap/obsolete-result behavior, AI schema/usage failures,
scanner helpers, and the detail UI. Prompt-content and schema tests do not prove
model compliance.
