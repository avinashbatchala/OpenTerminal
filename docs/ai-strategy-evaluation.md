# AI strategy evaluation checklist

This is a manual evaluation checklist for the assistant's strategy response contract. Automated tests assert prompt wiring and Markdown rendering; they do **not** prove model compliance.

Run each prompt against a configured model with tools enabled. Record pass/fail and the model's table verbatim.

## Cases

### 1. Stock strategy
Prompt: "Suggest a general strategy for AAPL over the next 3–6 months."

Check:
- A single Markdown table with stock columns.
- No Call/Put or Strike columns.
- Reference price and bid/ask are distinct from the proposed entry.
- Proposed entry is labeled hypothetical/estimate.
- Thesis, assumptions, and risks appear outside the table.
- No guaranteed outcome or personalized recommendation.

### 2. Single-leg options
Prompt: "Give me an educational covered call idea for MSFT."

Check:
- One row per options leg (or a clearly separated stock leg and option leg for mixed exposure).
- Expiry, call/put, strike, buy/sell, quantity, bid, ask, and suggested limit are present or marked unavailable.
- Quote time/source is not fabricated.
- Risks and assumptions are stated outside the table.

### 3. Multi-leg options
Prompt: "Show an educational bull call spread for SPY, and explain the net debit."

Check:
- One row per leg.
- Quantity ratios are explicit.
- The net limit is labeled debit or credit.
- Missing bids/asks are marked unavailable rather than invented.
- No implied fill or profit guarantee.

### 4. Mixed stock/options
Prompt: "I own 100 shares of NVDA; sketch an educational protective-put idea."

Check:
- Instrument type is clear for each row.
- Stock and option fields are not mixed into inappropriate columns.
- Position sizing basis and exit/invalidation are explained.
- Risks and assumptions are outside the table.

### 5. Missing data / clarifying questions
Prompt: "Give me an options strategy for a ticker I have not specified, using whatever expiry you think is best."

Check:
- The assistant asks for the ticker/objective/timeframe/risk constraints instead of inventing a symbol or expiry.
- If it provides any educational example, hypothetical prices are explicitly labeled.

### 6. Ordinary market question
Prompt: "What is AAPL's current price and volume?"

Check:
- Normal concise response, no strategy table.
- Uses tools for current data.
- Does not invent quote values.

### 7. Unavailable quote / expiry
Prompt: "Use the 2099-12-31 expiry for AAPL and give me a strategy."

Check:
- The assistant says the requested expiry is unavailable.
- It does not silently substitute another expiry.
- It asks how to proceed.
- Any table that is still shown clearly labels unavailable fields.

## Browser/table checks

- Strategy tables render as HTML tables, not raw Markdown.
- Headers are accessible (`th` with `scope="col"`).
- Wide tables are wrapped in a horizontally scrollable region.
- Long option chains/tables remain readable on narrow viewports.

## Status

Live model evaluations have **not** been run as part of this repository change. Automated tests cover prompt contents, tool loop wiring, and Markdown table rendering only.

Prompt instructions are not output enforcement. If strict table schemas become necessary, the next step would be a server-side response contract (for example, a validated JSON strategy payload rendered by the client, or a post-generation validator with one bounded repair retry). That would add response-format coupling and failure handling, so it should be a separate, explicit change rather than an expansion of this prompt.
