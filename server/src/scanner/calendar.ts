import type { Horizon } from "./types.js";

const NY_TZ = "America/New_York";

type NyParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
  dateKey: string;
};

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NY_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateKeyFromParts(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function nyParts(date: Date): NyParts {
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  return {
    year,
    month,
    day,
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday: values.weekday ?? "",
    dateKey: dateKeyFromParts(year, month, day),
  };
}

function offsetMinutes(date: Date): number {
  const p = nyParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** Convert a New York wall-clock time into the correct UTC instant across DST. */
export function nyWallTimeToUtc(dateKey: string, hour: number, minute = 0): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const pseudo = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let actual = pseudo;
  for (let i = 0; i < 3; i++) {
    const offset = offsetMinutes(new Date(actual));
    const next = pseudo - offset * 60_000;
    if (next === actual) break;
    actual = next;
  }
  return new Date(actual);
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = utcDate(year, month, day);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKeyFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function weekdayOf(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return utcDate(year, month, day).getUTCDay();
}

function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = utcDate(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return dateKeyFromParts(year, month, 1 + offset + (n - 1) * 7);
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return dateKeyFromParts(year, month, last.getUTCDate() - offset);
}

function observedFixed(year: number, month: number, day: number): string {
  const key = dateKeyFromParts(year, month, day);
  const weekday = weekdayOf(key);
  if (weekday === 6) return addDays(key, -1);
  if (weekday === 0) return addDays(key, 1);
  return key;
}

/** Gregorian Easter Sunday (Meeus/Jones/Butcher). */
function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dateKeyFromParts(year, month, day);
}

function holidaysAround(year: number): Set<string> {
  const set = new Set<string>();
  for (const y of [year - 1, year, year + 1]) {
    set.add(observedFixed(y, 1, 1));
    set.add(nthWeekday(y, 1, 1, 3)); // MLK
    set.add(nthWeekday(y, 2, 1, 3)); // Presidents
    set.add(addDays(easterSunday(y), -2)); // Good Friday
    set.add(lastWeekday(y, 5, 1)); // Memorial
    set.add(observedFixed(y, 6, 19)); // Juneteenth
    set.add(observedFixed(y, 7, 4)); // Independence
    set.add(nthWeekday(y, 9, 1, 1)); // Labor
    set.add(nthWeekday(y, 11, 4, 4)); // Thanksgiving
    set.add(observedFixed(y, 12, 25)); // Christmas
  }
  return set;
}

export function isMarketHoliday(dateKey: string): boolean {
  const year = Number(dateKey.slice(0, 4));
  return holidaysAround(year).has(dateKey);
}

export type SessionDay = {
  date: string;
  isTradingDay: boolean;
  open: string | null;
  close: string | null;
  earlyClose: boolean;
  holiday: boolean;
};

export function sessionDay(dateKey: string): SessionDay {
  const weekday = weekdayOf(dateKey);
  const holiday = isMarketHoliday(dateKey);
  const isTradingDay = weekday >= 1 && weekday <= 5 && !holiday;
  if (!isTradingDay) {
    return { date: dateKey, isTradingDay: false, open: null, close: null, earlyClose: false, holiday };
  }
  const year = Number(dateKey.slice(0, 4));
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  const dayAfterThanksgiving = addDays(thanksgiving, 1);
  const earlyClose =
    dateKey === dayAfterThanksgiving ||
    dateKey === `${year}-07-03` ||
    dateKey === `${year}-12-24`;
  return {
    date: dateKey,
    isTradingDay: true,
    open: nyWallTimeToUtc(dateKey, 9, 30).toISOString(),
    close: nyWallTimeToUtc(dateKey, earlyClose ? 13 : 16, 0).toISOString(),
    earlyClose,
    holiday: false,
  };
}

function nextTradingDay(dateKey: string): string {
  let candidate = dateKey;
  for (let i = 0; i < 14; i++) {
    candidate = addDays(candidate, 1);
    if (sessionDay(candidate).isTradingDay) return candidate;
  }
  return candidate;
}

function previousTradingDay(dateKey: string): string {
  let candidate = dateKey;
  for (let i = 0; i < 14; i++) {
    candidate = addDays(candidate, -1);
    if (sessionDay(candidate).isTradingDay) return candidate;
  }
  return candidate;
}

export type SessionState = {
  state: "open" | "closed" | "unavailable";
  label: string;
  date: string | null;
  nextOpen: string | null;
  nextClose: string | null;
};

export function sessionState(now = new Date()): SessionState {
  try {
    const ny = nyParts(now);
    const day = sessionDay(ny.dateKey);
    if (!day.isTradingDay) {
      const next = nextTradingDay(ny.dateKey);
      return {
        state: "closed",
        label: day.holiday ? "Market holiday" : "Weekend",
        date: ny.dateKey,
        nextOpen: sessionDay(next).open,
        nextClose: sessionDay(next).close,
      };
    }
    const open = day.open ? Date.parse(day.open) : NaN;
    const close = day.close ? Date.parse(day.close) : NaN;
    if (now.getTime() < open) {
      return {
        state: "closed",
        label: day.earlyClose ? "Pre-market (shortened session)" : "Pre-market",
        date: ny.dateKey,
        nextOpen: day.open,
        nextClose: day.close,
      };
    }
    if (now.getTime() >= close) {
      const next = nextTradingDay(ny.dateKey);
      return {
        state: "closed",
        label: "After hours",
        date: ny.dateKey,
        nextOpen: sessionDay(next).open,
        nextClose: sessionDay(next).close,
      };
    }
    return {
      state: "open",
      label: day.earlyClose ? "Regular session (early close)" : "Regular session",
      date: ny.dateKey,
      nextOpen: day.open,
      nextClose: day.close,
    };
  } catch {
    return {
      state: "unavailable",
      label: "Session calendar unavailable",
      date: null,
      nextOpen: null,
      nextClose: null,
    };
  }
}

export function isRegularSessionOpen(now = new Date()): boolean {
  return sessionState(now).state === "open";
}

export function intradayDeadline(now = new Date()): string {
  const ny = nyParts(now);
  const day = sessionDay(ny.dateKey);
  if (day.isTradingDay && day.close) return day.close;
  return sessionDay(nextTradingDay(ny.dateKey)).close ?? now.toISOString();
}

export function swingDeadline(expiry: string): string {
  const day = sessionDay(expiry);
  if (day.isTradingDay && day.open) return day.open;
  return sessionDay(nextTradingDay(expiry)).open ?? nyWallTimeToUtc(expiry, 9, 30).toISOString();
}

export function setupDeadline(horizon: Horizon, expiry: string, now = new Date()): string {
  return horizon === "intraday" ? intradayDeadline(now) : swingDeadline(expiry);
}

export function previousSessionClose(now = new Date()): string | null {
  const ny = nyParts(now);
  const prev = previousTradingDay(ny.dateKey);
  return sessionDay(prev).close;
}
