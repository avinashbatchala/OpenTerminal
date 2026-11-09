# Paper trading execution architecture

Status: **P0 + P1 implemented** (broker port, order lifecycle, paper fill model,
contract tests, SQLite store, execution engine, manual enter/close API).
Automation, marks/equity and UI follow in later phases.

## Invariant

The execution engine depends on `BrokerPort` only. It never imports market-data
fetching, slippage math, or a broker SDK. Paper is an adapter; a live broker is a
second adapter behind the same port. There is no `if (mode === "live")` in domain
logic — mode is decided once, in the composition root.

## Port

`server/src/execution/ports/broker.ts` defines:

- branded `ClientOrderId`, `BrokerOrderId`, `FillId`
- `Result<T, BrokerError>` for expected failures
- `BrokerCapabilities` (asset classes, multi-leg, partials, cancel, order types,
  push/poll fills)
- `BrokerOrderRequest` (client id, open/close intent, legs, limit/market,
  signed net limit price, TIF)
- `BrokerOrderUpdate` (`acknowledged` | `fill` | `rejected` | `cancelled` |
  `expired`)
- `BrokerSnapshot` (cash, positions, open orders) for reconciliation
- `BrokerPort` (`capabilities`, `submit`, `cancel`, `subscribe`, `snapshot`)

Everything is async and event-driven, even though the paper adapter fills
synchronously. That is deliberate: live venues acknowledge first and fill later.

## Order lifecycle

`server/src/execution/domain/order.ts` reduces broker updates into:

```
submitted -> acknowledged -> partially_filled -> filled
                          \-> cancelled | expired | rejected
```

- Fills accumulate; overfills are rejected.
- Duplicate acknowledgements are idempotent.
- Terminal orders cannot be resurrected by a late frame.
- Partial fills keep executed quantity when the remainder is cancelled/rejected.

## Fill accounting

`server/src/execution/domain/fill.ts` turns adapter fills into one
`FillSummary`: fees, signed net package price, mid price, slippage in dollars and
as a percentage of mid. A live broker and the paper model produce the same
`LegFill[]`, so P&L, UI and metrics are adapter-independent.

## Paper adapter

- `adapters/paper/fillModel.ts` — deterministic package model:
  `mid ± (halfSpread × spreadFactor + impact + seeded jitter)`, per-leg and
  package slippage caps, stale/crossed/missing quote rejection, AON, fee model.
  Jitter is seeded from the trade id so replays are identical.
- `adapters/paper/broker.ts` — in-memory `BrokerPort`: idempotent submit,
  acknowledge-then-fill events, normalized rejects, cancel, snapshot with cash
  and positions.

## Store and engine (P1)

- Tables (migration `execution_schema_migrations` v1): `execution_config`,
  `execution_trades`, `execution_orders`, `execution_fills`,
  `execution_events`, `execution_lease`.
- `ExecutionStore` persists the full broker order state, idempotent fills, a
  unique dedupe key per event, and a single-row lease.
- `ExecutionEngine` depends only on `BrokerPort` + `SetupSource` + market data.
  It opens a manual entry only when the scanner lifecycle is `entry_ready`,
  enforces one trade per opportunity plus open/per-symbol limits, prices a
  marketable limit from the live chain, and drives the trade from broker events.
- Closing reverses the legs and records realized P&L from the two fill
  summaries. Rejections leave the trade open (exit) or mark it rejected
  (entry), with an append-only event.

## API (P1)

All routes are authenticated (`x-api-key`) under `/api/execution`:

- `GET /status` — config, trade counts, open trades, broker cash/positions.
- `GET /trades?status=&limit=` — recent trades.
- `GET /trades/:id` — trade, orders, fills and events.
- `POST /enter` `{ opportunityId }` — manual simulated entry (`201` open,
  `202` pending).
- `POST /trades/:id/close` — manual simulated exit.

No automation runs yet; the scheduler, exit policies and UI are P2+.

## Adding a live broker

1. Implement `BrokerPort` in `server/src/execution/adapters/<venue>/broker.ts`.
2. Pass `brokerContract()` (`adapters/brokerContract.ts`) with a mocked transport.
3. Map venue errors into the `BrokerError` union — never leak vendor types.
4. Map fills/positions into `BrokerOrderUpdate` / `BrokerSnapshot`; keep the
   vendor order id internal.
5. Declare real `BrokerCapabilities`; the engine adapts order shape from them.
6. Add the adapter to the composition root (mode `live`), behind credentials in
   server settings/env, explicit confirmation, and the same risk limits.
7. Implement reconciliation: diff `snapshot()` against the internal ledger and
   pause automation on mismatch.

No engine, policy, store or UI changes are required.

## Tests

- `adapters/paper/fillModel.test.ts` — spread/impact/jitter, staleness, AON,
  caps, fees, net/mid/slippage.
- `adapters/paper/broker.test.ts` + `brokerContract` — idempotency, ack before
  fill, normalized reject, snapshot, cancel.
- `domain/order.test.ts` — transitions, partial fills, overfill, terminal states.
- `domain/fill.test.ts` — debit/credit netting, slippage sign, invalid legs.
