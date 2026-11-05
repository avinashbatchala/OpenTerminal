# Opportunity recipes v1 — review draft

Status: proposed, disabled, not approved for activation. These are testable
screening hypotheses, not validated profitable strategies or personalized trading
recommendations. Numerical indicator settings below are provisional engineering
inputs for review. Backtesting and paper observation are separate validation work.

## Common contract

Version each recipe, its parameters, feature calculations, and configuration.
Run discovery on closed bars: proposed intraday feature interval is five minutes;
swing features use completed daily bars. Five-minute swing checks may assess
current entry/invalidation prices but cannot turn an incomplete daily bar into a
completed signal. Require sufficient warm-up data and adjusted-data consistency.

Every setup stores exact signal-bar time, direction, horizon, rule version,
original feature values, exact contracts/expiry/legs, reference quotes, and frozen
entry, invalidation, target, and deadline conditions. Do not move these levels to
keep a thesis alive. A replacement must link to the prior setup.

All recipes share the confirmed one-unit, $250 modeled-loss cap including
configured fees; earnings exclusions; required expiry ranges; and verified data
requirements. Proposed scope is standard, unadjusted equity/ETF option contracts
with verified deliverables/multipliers, matching underlying and expiry across
spread legs. Unsupported contracts are held, not assumed to have a 100 multiplier.

Require configured maximum quote age and inter-leg timestamp skew, bid/ask width
limits, minimum volume/open interest, and fees before recipe activation. Validate
noncrossed quotes and positive prices; require usable bids for short legs. Record
why a gate failed. Actual option quote timestamps and coherent multi-leg quotes
must be available; fetching an old cached quote now does not make it fresh.

Proposed conservative screening reference: buying at observed ask and selling at
observed bid. These are observations, not executable package quotes or fill
promises. Label any midpoint-based proposed limit separately; never qualify risk
using an optimistic limit that the displayed market does not support. State fees,
payoff assumptions, and separate slippage scenarios explicitly.

## Proposed recipes

### TREND-PULLBACK v1

- Indicators: EMA20 and EMA50 on the horizon's completed bars.
- Bullish discovery: EMA20 > EMA50, and the latest closed bar touches/crosses EMA20
  but closes above it. Bearish discovery mirrors these conditions.
- Watching entry level: bullish signal-bar high plus a configured positive price
  buffer; bearish signal-bar low minus the buffer.
- Invalidation: bullish signal-bar low minus that buffer; bearish signal-bar high
  plus the buffer. Check invalidation before entry when evidence is ambiguous.
- Target observation: configured R multiple beyond entry, where R is the absolute
  underlying entry-to-invalidation distance; label it as an underlying-price
  milestone, not option profit. R must be nonzero and configured.
- Candidate instruments: matching-direction long call/put or same-expiry debit
  spread, separately evaluated. Do not imply these alternatives have identical
  exposures or equal value.

### RANGE-BREAKOUT v1

- Reference range: high/low of the 20 closed bars preceding the signal bar.
- Bullish discovery: signal bar closes above that range high plus configured
  breakout buffer. Bearish discovery mirrors the range low.
- Require configured signal-bar relative-volume threshold against the preceding
  20 bars. Missing/comparably invalid volume blocks this recipe.
- Entry readiness: next observed verified price remains beyond the breakout level
  but within a configured maximum chase distance. Never claim an earlier entry
  was observed while the scanner was offline.
- Invalidation: a completed bar closes back inside the frozen reference range.
- Target: configured R multiple using the frozen entry threshold and range-edge
  invalidation level. Gap-through/ambiguous checks are recorded explicitly.
- Instruments: direction-matched long option or debit spread, evaluated separately.

### MEAN-REVERSION v1

- Indicators: Bollinger bands using 20 bars and two standard deviations; RSI14.
- Bullish discovery: previous close was below its lower band with RSI <= 30,
  followed by a completed close back inside the bands. Bearish discovery mirrors
  the upper band with RSI >= 70. These settings are proposed, not established edge.
- Require a configurable trend-strength exclusion so a strongly trending symbol
  is not automatically treated as range-bound. Define its formula before use.
- Entry: verified price crosses the re-entry signal-bar high/low in the intended
  direction within the configured chase distance.
- Invalidation: price crosses the frozen two-bar extreme plus/minus buffer.
- Target: the band midpoint captured at discovery. Reject if it is already reached
  or is on the wrong side of entry; do not continuously move the target.
- Instruments: long call/put or debit spread matching the reversion direction.

### VOLATILITY-RANGE v1

- A range-bound regime must pass a configured quantitative test, rather than an
  AI description. Proposed ingredients: EMA20/EMA50 separation normalized by
  underlying price and the preceding 20-bar price range. Thresholds require review.
- Require elevated implied volatility against a documented historical reference
  for a consistent tenor/moneyness. Define the IV series, lookback, observations,
  and threshold explicitly. Do not substitute historical realized volatility for
  IV rank, invent an IV percentile, or infer a volatility edge from one quote.
- Instrument: one short iron condor with same expiry, nonoverlapping ordered
  strikes, and protective wings. Both short strikes must lie outside the frozen
  reference range plus a configured buffer. Verify every leg and complete payoff.
- Entry: valid regime, volatility evidence, quotes, and minimum configured net
  credit all hold on a subsequent check. Persist a material-change threshold.
- Invalidation: a verified underlying price crosses either frozen short strike,
  or the configured regime-exit rule holds on a closed bar.
- Optional target milestone: coherent observed package closing debit falls below
  a configured fraction of the frozen reference credit after entry readiness.
  This is hypothetical package repricing, not actual position P&L.
- If IV history is unavailable, show this recipe as warming up/unavailable. Other
  recipes can run independently; AI must not fill the missing volatility evidence.

### VOLATILITY-TREND-CREDIT v1

- Require TREND-PULLBACK's directional evidence and VOLATILITY-RANGE's elevated-IV
  evidence, with a separate explicit recipe identity.
- Bullish instrument: one same-expiry bull put credit spread; bearish instrument:
  one same-expiry bear call credit spread. Short strike must remain beyond the
  frozen invalidation level with a configured distance buffer.
- Entry requires coherent quotes, configured minimum net credit, and intact
  directional evidence on a subsequent check.
- Invalidation uses the frozen directional invalidation threshold. Optional
  package-repricing target follows the same labeled hypothetical rule as above.
- Missing IV history holds this recipe independently of debit/long-option recipes.

## Contract selection and payoff validation

Choose only expiries within the user's required horizon range and lifecycle
deadline. Proposed deterministic selection order: configured distance to target
expiry, configured moneyness/strike-distance bands, liquidity quality, then stable
contract identifier. Require a selection policy before activation. Do not choose
the highest theoretical return or fit a worse contract solely to force $250 risk.
Preserve full-precision market values for calculations, with currency-safe
rounding at defined boundaries. Require strict strike ordering and consistent
deliverables. Check the complete unit before displaying qualification.

For standard matched contracts with multiplier M, reference debit D, reference
credit C, and spread widths W:
- Long option and debit vertical modeled loss: D * M + configured fees.
- Credit vertical modeled loss: (W - C) * M + configured fees.
- Short iron condor modeled loss: (max(putWidth, callWidth) - C) * M + fees.
Reject economically inconsistent quotes, impossible premiums, missing legs, or
negative calculated risk rather than marking a setup risk-free.

These describe bounded expiration payoff under the stated intact-position
assumptions. Assignment, exercise, legging, execution, and other real-world
exposures are not guaranteed bounded by the displayed scenario. The application
does not execute trades or infer fills.

Educational payoff references:
- [OIC bull call spread](https://www.optionseducation.org/strategies/all-strategies/bull-call-spread-debit-call-spread)
- [Schwab iron condor explanation](https://www.schwab.com/learn/story/iron-condors-what-they-are-and-how-to-use-them)

## Identity, monitoring, and unresolved parameters

Proposed identity: recipe version + symbol + horizon + direction + signal-bar time
+ exact contracts and leg sides/ratios. Candidate construction must be stable
across scans of the same signal. Quote updates do not create a new identity.
A fresh signal requires a documented reset/re-arm condition; parameter changes
and different strikes alone must not evade a prior dismissal. This policy needs
confirmation before activation.

Intraday deadline: that day's regular-session close. Swing default: regular-session
open on expiry day, or earlier explicit recipe deadline. Targets observed after
entry readiness produce deduplicated events without stopping monitoring. Removing
a symbol stops new discovery and asks whether to continue existing monitoring;
retain checks while awaiting the choice. No invented outcomes during data gaps.

Before activation, review and configure: signal buffers, chase limits, relative
volume/regime tests, target settings, expiry and strike-selection rules, liquidity
and timestamp limits, fee components/values, slippage scenarios, IV-history
methodology, and signal reset/re-arm policy. No invented confidence percentage or
profit probability may substitute for validation. All recipe thresholds and their
provenance must be visible to the user.
