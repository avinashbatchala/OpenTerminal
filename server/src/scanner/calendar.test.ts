import { describe, expect, it } from "vitest";
import {
  intradayDeadline,
  isMarketHoliday,
  isRegularSessionOpen,
  nyWallTimeToUtc,
  sessionDay,
  sessionState,
  swingDeadline,
} from "./calendar.js";

describe("US exchange calendar", () => {
  it("handles DST conversion for New York regular-session times", () => {
    expect(nyWallTimeToUtc("2026-03-09", 9, 30).toISOString()).toBe("2026-03-09T13:30:00.000Z");
    expect(nyWallTimeToUtc("2026-11-02", 9, 30).toISOString()).toBe("2026-11-02T14:30:00.000Z");
    expect(nyWallTimeToUtc("2026-11-02", 16, 0).toISOString()).toBe("2026-11-02T21:00:00.000Z");
  });

  it("recognizes holidays and shortened sessions", () => {
    expect(isMarketHoliday("2026-11-26")).toBe(true); // Thanksgiving
    expect(isMarketHoliday("2026-04-03")).toBe(true); // Good Friday
    expect(isMarketHoliday("2026-07-03")).toBe(true); // observed Independence Day
    expect(sessionDay("2026-11-26").isTradingDay).toBe(false);
    expect(sessionDay("2026-11-27").earlyClose).toBe(true);
    expect(sessionDay("2026-11-27").close).toBe("2026-11-27T18:00:00.000Z");
    expect(sessionDay("2026-12-24").earlyClose).toBe(true);
  });

  it("reports open, pre-market, after-hours, weekend, and early-close states", () => {
    expect(sessionState(new Date("2026-11-02T15:00:00Z"))).toMatchObject({
      state: "open",
      label: "Regular session",
    });
    expect(sessionState(new Date("2026-11-02T12:00:00Z"))).toMatchObject({ state: "closed" });
    expect(sessionState(new Date("2026-11-02T22:00:00Z"))).toMatchObject({ state: "closed" });
    expect(sessionState(new Date("2026-11-01T15:00:00Z"))).toMatchObject({ state: "closed" });
    expect(sessionState(new Date("2026-11-27T17:59:00Z"))).toMatchObject({ state: "open" });
    expect(sessionState(new Date("2026-11-27T18:00:00Z"))).toMatchObject({ state: "closed" });
  });

  it("computes intraday and swing deadlines from session boundaries", () => {
    expect(intradayDeadline(new Date("2026-11-02T15:00:00Z"))).toBe(
      "2026-11-02T21:00:00.000Z"
    );
    expect(swingDeadline("2026-11-20")).toBe("2026-11-20T14:30:00.000Z");
    expect(isRegularSessionOpen(new Date("2026-11-02T15:00:00Z"))).toBe(true);
    expect(isRegularSessionOpen(new Date("2026-11-02T22:00:00Z"))).toBe(false);
  });
});
