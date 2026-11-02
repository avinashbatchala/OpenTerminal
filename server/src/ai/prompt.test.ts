import { describe, expect, it } from "vitest";
import { AI_SYSTEM_PROMPT } from "./prompt.js";

describe("AI strategy system prompt", () => {
  it("keeps strategy output in Markdown tables with stock and options columns", () => {
    expect(AI_SYSTEM_PROMPT).toContain("Markdown table");
    expect(AI_SYSTEM_PROMPT).toContain("| Symbol | Buy/Sell/Hold | Reference Price |");
    expect(AI_SYSTEM_PROMPT).toContain("| Strategy | Leg | Symbol | Expiry | Call/Put |");
    expect(AI_SYSTEM_PROMPT).toContain("Use one row per leg");
    expect(AI_SYSTEM_PROMPT).toContain("Instrument column");
  });

  it("separates observed quotes from hypothetical proposed levels", () => {
    expect(AI_SYSTEM_PROMPT).toContain("Distinguish observed market bid/ask");
    expect(AI_SYSTEM_PROMPT).toContain("Proposed prices are hypothetical");
    expect(AI_SYSTEM_PROMPT).toContain("Not specified");
    expect(AI_SYSTEM_PROMPT).toContain("Unavailable");
  });

  it("keeps ordinary market questions table-free and labels hypothetical examples", () => {
    expect(AI_SYSTEM_PROMPT).toContain("Ordinary market questions keep their normal response format");
    expect(AI_SYSTEM_PROMPT).toContain("educational hypothetical price");
  });

  it("covers multi-leg net debit/credit and data integrity rules", () => {
    expect(AI_SYSTEM_PROMPT).toContain("debit or a credit");
    expect(AI_SYSTEM_PROMPT).toContain("Do not invent symbols");
    expect(AI_SYSTEM_PROMPT).toContain("Do not silently substitute");
    expect(AI_SYSTEM_PROMPT).toContain("Never label retrieval time as the exchange quote timestamp");
    expect(AI_SYSTEM_PROMPT).toContain("clarifying questions");
  });

  it("keeps the educational-advice boundary", () => {
    expect(AI_SYSTEM_PROMPT).toContain("not a licensed financial advisor");
    expect(AI_SYSTEM_PROMPT).toContain("General and educational strategy ideas are allowed");
    expect(AI_SYSTEM_PROMPT).toContain("Do not use the user's portfolio");
  });
});
