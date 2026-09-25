// Timezone arithmetic for the email scheduler, with Intl only. Calendar days are
// "YYYY-MM-DD" strings (the format DATE columns arrive in) and are compared as
// strings; instants are Dates.

export type LocalParts = {
  /** YYYY-MM-DD in the zone. */
  date: string;
  /** 0–23 in the zone. */
  hour: number;
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  isoDow: number;
};

const DAY_MS = 86_400_000;
const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function createFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

// An unknown zone falls back to UTC, as todayIn() does: one misconfigured
// organization must not stop every other organization's email.
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = createFormatter(timeZone);
  } catch {
    formatter = createFormatter("UTC");
  }
  formatters.set(timeZone, formatter);
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    createFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function wallClock(date: Date, timeZone: string): WallClock {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour % 24,
    minute: values.minute,
    second: values.second,
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

function parseYmd(ymd: string): [number, number, number] {
  const match = YMD.exec(ymd);
  if (!match) throw new RangeError(`Not a YYYY-MM-DD date: ${ymd}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

const utcMidnight = (ymd: string) => {
  const [year, month, day] = parseYmd(ymd);
  return Date.UTC(year, month - 1, day);
};

export function isoWeekday(ymd: string): number {
  const dow = new Date(utcMidnight(ymd)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

const wallDate = (clock: WallClock) => `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`;

export function localParts(date: Date, timeZone: string): LocalParts {
  const clock = wallClock(date, timeZone);
  const ymd = wallDate(clock);
  return { date: ymd, hour: clock.hour, isoDow: isoWeekday(ymd) };
}

/** The zone's calendar day for an instant, or null when it is not a real YYYY-MM-DD (year 20266). */
export function localDay(date: Date, timeZone: string): string | null {
  return Number.isNaN(date.getTime()) ? null : toYmd(wallDate(wallClock(date, timeZone)));
}

export function addDays(ymd: string, days: number): string {
  return new Date(utcMidnight(ymd) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS);
}

const isWorkingDay = (ymd: string, workingDays: readonly number[]) =>
  workingDays.includes(isoWeekday(ymd));

/** The first working day after `ymd`; the next calendar day when none is configured. */
export function nextWorkingDay(ymd: string, workingDays: readonly number[]): string {
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = addDays(ymd, offset);
    if (isWorkingDay(candidate, workingDays)) return candidate;
  }
  return addDays(ymd, 1);
}

/** The last working day before `ymd`; the previous calendar day when none is configured. */
export function prevWorkingDay(ymd: string, workingDays: readonly number[]): string {
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = addDays(ymd, -offset);
    if (isWorkingDay(candidate, workingDays)) return candidate;
  }
  return addDays(ymd, -1);
}

function offsetMs(instant: number, timeZone: string): number {
  const clock = wallClock(new Date(instant), timeZone);
  const asUtc = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `timeZone` reads `ymd` `hour`:00. `hour` may be 24 or
 * more, meaning that many hours past the day's midnight (a send window that ends after midnight).
 */
export function zonedTimeToUtc(ymd: string, hour: number, timeZone: string): Date {
  const [year, month, day] = parseYmd(ymd);
  const target = Date.UTC(year, month - 1, day, hour);
  const first = target - offsetMs(target, timeZone);
  const secondOffset = offsetMs(first, timeZone);
  const second = target - secondOffset;
  if (second === first) return new Date(first);
  // Near a DST change the passes disagree and `first` is off by the change. `second` is right
  // unless the wall time falls in a spring-forward gap, where the later instant is used.
  return new Date(offsetMs(second, timeZone) === secondOffset ? second : Math.max(first, second));
}

export const startOfLocalDay = (ymd: string, timeZone: string) => zonedTimeToUtc(ymd, 0, timeZone);

/**
 * The "YYYY-MM-DD" day at the start of a DATE value, or null for anything else. A typo'd year
 * (Postgres happily stores 20266-09-02) must read as "no date", never throw inside a tick.
 */
export function toYmd(value: string | null | undefined): string | null {
  const day = value?.slice(0, 10) ?? "";
  return YMD.test(day) ? day : null;
}

type DueFields = { dueDate: string | null; dueAt: string | null };

/** A task's due day in the organization's calendar: the DATE column, else the timestamp's local day. */
export function effectiveDue(task: DueFields, timeZone: string): string | null {
  const day = toYmd(task.dueDate);
  if (day) return day;
  return task.dueAt ? localDay(new Date(task.dueAt), timeZone) : null;
}

/** "Fri, 25 Sep 2026". Built by hand: en-GB Intl output varies by ICU version ("Sept"). */
export function formatDate(ymd: string): string {
  const [year, month, day] = parseYmd(ymd);
  return `${WEEKDAY_SHORT[isoWeekday(ymd) - 1]}, ${day} ${MONTH_SHORT[month - 1]} ${year}`;
}

/** "Fri, 18 Sep – Thu, 24 Sep 2026"; both years shown when they differ. */
export function formatDateRange(startYmd: string, endYmd: string): string {
  const [startYear] = parseYmd(startYmd);
  const [endYear] = parseYmd(endYmd);
  const start =
    startYear === endYear ? formatDate(startYmd).replace(/ \d{4}$/, "") : formatDate(startYmd);
  return `${start} – ${formatDate(endYmd)}`;
}
