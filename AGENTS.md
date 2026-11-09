# AGENTS.md

## What this is

npm-workspaces monorepo for OpenTerminal:

- `server/` — Express + TypeScript API on port 4000; providers, caching, SQLite.
- `web/` — Next.js 15 / React 19 / Tailwind 4 UI on port 3000.
- `data/` — runtime SQLite DB and generated `.api-key` (gitignored).

Node 22 is the supported runtime (CI and Docker). No `.env` is required for local dev.

## Commands (from repo root)

- `npm install` — install both workspaces.
- `cp .env.example .env` — optional local config; the root `.env` is shared by both processes and is gitignored.
- `npm run dev` — API + web together; health at `http://localhost:4000/api/status`.
- `npm test` — server + web Vitest suites; tests make no network calls.
- `npm test -w server -- src/cache.test.ts` / `npm test -w web -- lib/chatState.test.ts` — one file; add `-t "test name"` to narrow further.
- `npm run build` — `tsc` for server, then `next build`; this is the only repo-wide typecheck. **Stop `npm run dev` first**: dev and build both write `web/.next`, and a build run alongside the dev server leaves it serving production manifests (`/_app` undefined / 500s) until `.next` is removed and dev restarted.
- `npm run build -w server` / `npm run build -w web` — one side only.
- `npm run schwab:auth -w server` — optional one-time Schwab OAuth; prints a URL, then accept the callback URL as an argument to store tokens.
- `npm run lint` does **not** work: `next lint` has no ESLint config, opens an interactive setup prompt, then exits 1. Don't run it; use the builds to verify. CI skips lint too.
- `docker compose up --build` — full stack.

## Architecture gotchas

- The browser never calls the Express API directly. Widgets use relative `/api/...`; `web/app/api/[...path]/route.ts` proxies to `API_URL` (default `http://localhost:4000`) and attaches `x-api-key` server-side. Keep this as a route handler rather than a `next.config.ts` rewrite — rewrites cannot add the header — and never expose the key to the client.
- Auth: with no `API_KEY`, `server/src/auth.ts` generates `data/.api-key`; `web/lib/api-key.ts` reads that same file. `/api/portfolios`, `/api/ai`, `/api/schwab`, `/api/stream`, and `/api/settings` require the key; market routes are intentionally keyless but per-IP rate-limited in `server/src/index.ts`. Don't loosen the localhost bind, CORS origin, or rate limits without updating the security notes in `README.md`.
- Server relative imports must end in `.js` (NodeNext ESM) even though the source is `.ts`: `import { cached } from "../cache.js"`. Web uses bundler resolution and the `@/*` alias.
- The root `.env` is shared by both processes: `server/src/paths.ts` loads it before reading `DATA_DIR`/keys, and `web/next.config.ts` loads it for the Next server/proxy. `.env` is gitignored; `.env.example` is the tracked template. Don't add a duplicate `web/.env` or `server/.env` loader.
- User-editable runtime settings live in `data/settings.json` via `server/src/settings.ts` (mode `0600`, gitignored), not in `.env`. It stores the data-source toggle (`schwab`/`public`) and optional AI overrides. The Settings page (`web/app/settings/page.tsx`) talks to `/api/settings` and `/api/schwab/auth`; the AI key is never returned to the browser. `market.ts`/`stream.ts` must keep honoring `dataSource: "public"` by not calling Schwab, and `routes/ai.ts` rebuilds its client when the key/base URL changes.
- AI uses an Anthropic tool-use loop (`server/src/ai/agent.ts`) with read-only tools in `server/src/ai/tools.ts`. Tool executors call the app's own `/api` market routes over loopback (`AI_INTERNAL_API_URL` overrides the base) so they inherit provider fallbacks, caching, rate limits, and the data-source toggle. Tool inputs are zod-validated, results are trimmed/size-limited, and the loop caps at 5 rounds. Don't add a tool that can fetch arbitrary URLs, read files/env, or touch portfolio/settings/trading data.
- The AI chat is a floating launcher/panel, not a widget. `ChatProvider` (`web/components/chat/`) must stay mounted above panel visibility so closing/reopening preserves messages, drafts, in-flight responses, and the preferred desktop size; `ChatLauncher` is mounted exactly once in `Terminal`, outside `Workspace`. Chat state is in-memory only (no localStorage). `ai` is retired from `WidgetType`; persisted layouts are sanitized by `web/lib/workspace.ts` so old AI widgets disappear without resetting other customizations. The panel sits at `z-40`, below the `z-50` command palette. Desktop resizing is owned by `useChatResize` + the pure clamp helpers in `web/lib/chatSize.ts` (root-font-relative minimums, viewport/safe-area maximums); the mobile sheet ignores the desktop size. Keep the top-left handle's pointer capture and body no-select cleanup intact.
- The Opportunity Scanner lives in `server/src/scanner/` and is **disabled by default**. It uses additive `scanner_*` tables in the shared SQLite DB (`store.ts` handles versioned migrations), an in-process scheduler with a DB lease, a deterministic recipe/risk layer, and a separate structured AI assessment prompt in `scanner/ai.ts`. AI explains/ranks but never writes eligibility, legs, risk, lifecycle, or scheduler state; all writes go through the scanner service. Scans snapshot `config.revision`, discard obsolete late results, and run only with a confirmed configuration during a verified US session. Browser watchlist state must be explicitly synchronized through `/api/scanner/watchlist`; do not make the API depend on localStorage. UI is the dashboard Opportunities widget (added from the sidebar or the top-bar control, with unread alert badges); scanner routes are authenticated in `index.ts`. Lifecycle is `watching → entry_ready → invalidated | expired | missed`; `missed` means the underlying left the configured chase band before entry. Between scans, a quote-only monitoring pass may invalidate, mark missed, or confirm entry (it fetches a chain only when the underlying is in band), and restart recovery releases the dead process's lease. Read `docs/opportunity-scanner-operations.md` before changing activation, lifecycle, watchlist-removal, or recovery behavior.
- `cached(key, ttl, fn)` in `server/src/cache.ts` is a TTL cache with stale-on-error fallback and bounded LRU — not background stale-while-revalidate. Use it around provider calls; use `cacheStore` to seed both fresh and stale caches after a manual fetch (as `getQuotes` does).
- Providers are isolated modules in `server/src/providers/`. Compose fallbacks with `withFallback([...])` from `providers/registry.ts` so `/api/status` health stats work, and bound fan-out with `mapWithConcurrency`. The default install must stay free/keyless; public endpoints are expected to need fallbacks.
- `/api/history/:symbol` accepts an optional `interval=Nm` (1–60). The scanner requests `interval=5m` for intraday features; the route rejects a provider whose median bar spacing does not match (so the fallback chain continues) instead of silently relabeling 1-minute or daily bars. Schwab's `1D`/`5D` default is 1-minute, so `historyFrequency()` must keep honoring the requested frequency.
- Optional Schwab is the only credentialed provider. `providers/schwabAuth.ts` owns OAuth token refresh/rotation, the rate-limit queue, and `data/.schwab-token.json` (gitignored); `providers/schwab.ts` maps market data; `providers/schwabStreamer.ts` owns the single upstream WebSocket for `LEVELONE_EQUITIES` quotes and `CHART_EQUITY` minute bars. When it is configured, quotes/history/options/search try Schwab first and still fall through to the public chain. Keep that fallback behavior; never make Schwab required.
- Streaming path: browser `EventSource` → `/api/stream/quotes` or `/api/stream/chart/:symbol` → Next proxy → Express SSE. The proxy in `web/app/api/[...path]/route.ts` has a `text/event-stream` pass-through; do not route SSE through the JSON buffering path. The streamer needs Node 22's global `WebSocket`. `CHART_EQUITY` feeds the 1D/5D chart's current 1-minute bar; history remains REST-based. The first subscription for each streamer service must be `SUBS`, with `ADD` only to extend an existing subscription.
- `getQuotes` in `server/src/routes/market.ts` has special branches before the normal fallback chain: crypto symbols route to Binance, VIX comes from FRED, and Schwab handles regular US symbols when enabled. Add new symbol classes there instead of assuming Nasdaq/Yahoo coverage.
- SQLite (`better-sqlite3`, WAL) schema is created at import time in `server/src/db.ts` via `CREATE TABLE IF NOT EXISTS`; there is no migration framework or migration command. Shared runtime paths (`dataDir`, `DATA_DIR`) live in `server/src/paths.ts`; `db.ts` re-exports `dataDir` for compatibility.

## Adding a widget

A new component alone is not enough. Update all relevant places:

1. `web/store/terminal.ts` — `WidgetType` union, `SIZE_BY_TYPE`, and defaults if it should ship by default.
2. `web/components/Workspace.tsx` — import, `WidgetBody` switch, `TITLES`, and `symbolAware` if it follows the active ticker.
3. `web/components/Sidebar.tsx` — its `ITEMS` entry.
4. `web/components/Terminal.tsx` — only if it gets an `⌥N` shortcut.

Widgets are client components using TanStack Query and relative `apiGet`/`apiPost`; each is wrapped in `WidgetErrorBoundary`. Don't add a floating/singleton surface through this path — the AI chat is the precedent for mounting those separately in `Terminal`.

## Tests

- Vitest discovers `server/src/**/*.test.ts`. The web workspace uses `web/vitest.config.ts` (jsdom + `web/test/setup.ts`) and discovers `web/**/*.test.ts(x)`. Root `npm test` runs both suites.
- Tests must not hit the network. Mock `globalThis.fetch` with `vi.stubGlobal("fetch", ...)` and restore it; route tests reach handlers through `*.router.stack` (see `server/src/routes/market.test.ts` and `routes/ai.test.ts`). `providers/schwab.test.ts` covers the pure Schwab mappers and streamer frame parser; `settings.test.ts` covers defaults/persistence/env fallback; `ai/tools.test.ts` covers tool validation/shaping with a mocked `fetch`; `ai/agent.test.ts` covers the tool-use loop with a fake Anthropic client; `ai/prompt.test.ts` asserts the server-owned strategy instructions; `routes/ai.test.ts` proves those instructions reach the model request. OAuth/WebSocket paths need real credentials and are intentionally not tested.
- Web tests mix pure logic (`lib/chatState.test.ts`, `lib/chatSize.test.ts`, `lib/workspace.test.ts`, `lib/viewport.test.ts`, `lib/scanner.test.ts`) with jsdom interaction tests for chat drafts, unread state, retries, composer keys/IME, focus ownership, desktop resize clamping/dragging/cancellation, size preservation, mobile transitions, the command palette, Markdown tables, and scanner detail rendering (`components/chat/*.test.tsx`, `components/scanner/*.test.tsx`, `components/CommandPalette.test.tsx`). DOM tests cover focus/keys and simulated pointer capture; the mobile software-keyboard placement and real drag behavior are verified manually in a browser. Verify UI changes with `npm run build -w web` plus the dev server.
- Scanner tests use isolated in-memory SQLite and injected market/model clients: `scanner/calendar.test.ts`, `config.test.ts`, `signals.test.ts`, `contracts.test.ts`, `store.test.ts`, `engine.test.ts`, and `ai.test.ts`. Keep automated tests network-free and never activate real scans or make paid model calls from tests. Manual provider/model validation is documented in `docs/opportunity-scanner-operations.md`.
- The strategy prompt contract has a manual model-evaluation checklist in `docs/ai-strategy-evaluation.md`; automated prompt tests prove wiring, not model compliance.
- `server/tsconfig.json` excludes tests and Vitest does not typecheck, so test files are never typechecked by the build or test commands.

## CI

`.github/workflows/ci.yml` runs on Node 22: `npm install` → `npm test` → `npm run build -w server` → `npm run build -w web`. Match that order before opening a PR. The README asks contributors to open an issue before non-trivial PRs.
