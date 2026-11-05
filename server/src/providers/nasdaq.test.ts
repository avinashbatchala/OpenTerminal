import { describe, expect, it } from "vitest";
import { parseNasdaqExpiry } from "./nasdaq.js";

describe("NASDAQ option expiry normalization", () => {
  it("resolves display dates to ISO dates", () => {
    expect(parseNasdaqExpiry("Nov 4", new Date("2026-11-02T15:00:00Z"))).toBe("2026-11-04");
    expect(parseNasdaqExpiry("November 20, 2026", new Date("2026-11-02T15:00:00Z"))).toBe(
      "2026-11-20"
    );
  });

  it("rolls a display date into the next year when it would already be stale", () => {
    expect(parseNasdaqExpiry("Jan 16", new Date("2026-12-20T15:00:00Z"))).toBe("2027-01-16");
    expect(parseNasdaqExpiry("Jan 16", new Date("2026-11-02T15:00:00Z"))).toBe("2027-01-16");
  });

  it("rejects missing or unreadable values instead of inventing an expiry", () => {
    expect(parseNasdaqExpiry(null)).toBeNull();
    expect(parseNasdaqExpiry("")).toBeNull();
    expect(parseNasdaqExpiry("not a date")).toBeNull();
  });
});
