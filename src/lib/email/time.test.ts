// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import {
  addDays,
  daysBetween,
  effectiveDue,
  formatDate,
  formatDateRange,
  isValidTimeZone,
  isoWeekday,
  localDay,
  localParts,
  nextWorkingDay,
  prevWorkingDay,
  startOfLocalDay,
  toYmd,
  zonedTimeToUtc,
} from "./time";

const MON_FRI = [1, 2, 3, 4, 5];
const SUN_THU = [7, 1, 2, 3, 4];
const at = (iso: string) => new Date(iso);

describe("localParts", () => {
  test("Dubai (UTC+4) rolls the day over at 20:00 UTC", () => {
    expect(localParts(at("2026-09-24T19:59:59Z"), "Asia/Dubai")).toEqual({
      date: "2026-09-24",
      hour: 23,
      isoDow: 4,
    });
    expect(localParts(at("2026-09-24T20:00:00Z"), "Asia/Dubai")).toEqual({
      date: "2026-09-25",
      hour: 0,
      isoDow: 5,
    });
  });

  test("Kolkata (UTC+5:30) rolls the day over at 18:30 UTC", () => {
    expect(localParts(at("2026-09-24T18:29:59Z"), "Asia/Kolkata").date).toBe("2026-09-24");
    expect(localParts(at("2026-09-24T18:30:00Z"), "Asia/Kolkata")).toEqual({
      date: "2026-09-25",
      hour: 0,
      isoDow: 5,
    });
  });

  test("the same instant is a different local hour in each zone", () => {
    const instant = at("2026-09-25T04:30:00Z");
    expect(localParts(instant, "Asia/Dubai").hour).toBe(8);
    expect(localParts(instant, "Asia/Kolkata").hour).toBe(10);
    expect(localParts(instant, "UTC").hour).toBe(4);
  });

  test("an unknown timezone falls back to UTC instead of throwing", () => {
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("Asia/Dubai")).toBe(true);
    expect(localParts(at("2026-09-25T23:30:00Z"), "Mars/Olympus_Mons")).toEqual({
      date: "2026-09-25",
      hour: 23,
      isoDow: 5,
    });
  });

  test("midnight is hour 0, never 24", () => {
    expect(localParts(at("2026-09-24T20:00:00Z"), "Asia/Dubai").hour).toBe(0);
  });
});

describe("calendar arithmetic", () => {
  test("isoWeekday is 1 for Monday through 7 for Sunday", () => {
    expect(isoWeekday("2026-09-28")).toBe(1);
    expect(isoWeekday("2026-09-25")).toBe(5);
    expect(isoWeekday("2026-09-27")).toBe(7);
  });

  test("addDays crosses months, years and leap days", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-09-25", -7)).toBe("2026-09-18");
  });

  test("daysBetween counts whole days either way", () => {
    expect(daysBetween("2026-09-24", "2026-09-25")).toBe(1);
    expect(daysBetween("2026-09-25", "2026-09-22")).toBe(-3);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
  });

  test("rejects anything that is not YYYY-MM-DD", () => {
    expect(() => addDays("25/09/2026", 1)).toThrow();
  });
});

describe("working days", () => {
  test("Friday's next working day is Monday; Monday's previous is Friday", () => {
    expect(nextWorkingDay("2026-09-25", MON_FRI)).toBe("2026-09-28");
    expect(prevWorkingDay("2026-09-28", MON_FRI)).toBe("2026-09-25");
    expect(nextWorkingDay("2026-09-23", MON_FRI)).toBe("2026-09-24");
  });

  test("a Sunday–Thursday week skips Friday and Saturday", () => {
    expect(nextWorkingDay("2026-09-24", SUN_THU)).toBe("2026-09-27");
    expect(prevWorkingDay("2026-09-27", SUN_THU)).toBe("2026-09-24");
  });

  test("from a weekend day, the neighbours are the nearest working days", () => {
    expect(nextWorkingDay("2026-09-26", MON_FRI)).toBe("2026-09-28");
    expect(prevWorkingDay("2026-09-26", MON_FRI)).toBe("2026-09-25");
  });

  test("with no working days configured, the neighbours are the adjacent calendar days", () => {
    expect(nextWorkingDay("2026-09-25", [])).toBe("2026-09-26");
    expect(prevWorkingDay("2026-09-25", [])).toBe("2026-09-24");
  });
});

describe("zonedTimeToUtc", () => {
  test("converts a local wall-clock hour to the UTC instant", () => {
    expect(zonedTimeToUtc("2026-09-25", 11, "Asia/Dubai").toISOString()).toBe(
      "2026-09-25T07:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-09-25", 11, "Asia/Kolkata").toISOString()).toBe(
      "2026-09-25T05:30:00.000Z",
    );
    expect(startOfLocalDay("2026-09-25", "Asia/Dubai").toISOString()).toBe(
      "2026-09-24T20:00:00.000Z",
    );
  });

  test("hours past 23 land on the next local day (a window that ends after midnight)", () => {
    const end = zonedTimeToUtc("2026-09-25", 25, "Asia/Dubai");
    expect(end.toISOString()).toBe("2026-09-25T21:00:00.000Z");
    expect(localParts(end, "Asia/Dubai")).toEqual({ date: "2026-09-26", hour: 1, isoDow: 6 });
  });

  test("handles DST zones on both sides of a change", () => {
    expect(zonedTimeToUtc("2026-07-01", 8, "America/New_York").toISOString()).toBe(
      "2026-07-01T12:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-11-01", 12, "America/New_York").toISOString()).toBe(
      "2026-11-01T17:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-03-08", 3, "America/New_York").toISOString()).toBe(
      "2026-03-08T07:00:00.000Z",
    );
    // 02:00 does not exist that morning in New York or 01:00 in London: the later instant is used.
    expect(
      localParts(zonedTimeToUtc("2026-03-08", 2, "America/New_York"), "America/New_York").hour,
    ).toBe(3);
    expect(localParts(zonedTimeToUtc("2026-03-29", 1, "Europe/London"), "Europe/London").hour).toBe(
      2,
    );
  });
});

describe("effectiveDue", () => {
  test("prefers the DATE column", () => {
    expect(
      effectiveDue({ dueDate: "2026-09-26", dueAt: "2026-09-30T10:00:00Z" }, "Asia/Dubai"),
    ).toBe("2026-09-26");
  });

  test("converts a timestamp to the organization's calendar day, not UTC's", () => {
    const late = { dueDate: null, dueAt: "2026-09-25T21:00:00.000Z" };
    expect(effectiveDue(late, "UTC")).toBe("2026-09-25");
    expect(effectiveDue(late, "Asia/Dubai")).toBe("2026-09-26");
    expect(effectiveDue({ dueDate: null, dueAt: "2026-09-25T18:45:00Z" }, "Asia/Kolkata")).toBe(
      "2026-09-26",
    );
  });

  test("no due date, or an unparseable one, is null", () => {
    expect(effectiveDue({ dueDate: null, dueAt: null }, "Asia/Dubai")).toBeNull();
    expect(effectiveDue({ dueDate: null, dueAt: "soon" }, "Asia/Dubai")).toBeNull();
  });

  test("a typo'd five-digit year reads as no due date, never throws", () => {
    // Postgres stores the typo and the snapshot returns it as "20266-09-02".
    expect(effectiveDue({ dueDate: "20266-09-02", dueAt: null }, "Asia/Dubai")).toBeNull();
    expect(
      effectiveDue({ dueDate: "20266-09-02", dueAt: "+020266-09-02T10:00:00Z" }, "Asia/Dubai"),
    ).toBeNull();
    // A readable timestamp still gives the day.
    expect(
      effectiveDue({ dueDate: "20266-09-02", dueAt: "2026-09-25T21:00:00Z" }, "Asia/Dubai"),
    ).toBe("2026-09-26");
  });
});

describe("localDay", () => {
  test("is the zone's calendar day, or null for an invalid or five-digit-year instant", () => {
    expect(localDay(at("2026-09-25T21:00:00Z"), "Asia/Dubai")).toBe("2026-09-26");
    expect(localDay(at("not a date"), "Asia/Dubai")).toBeNull();
    expect(localDay(at("+020266-09-02T10:00:00Z"), "Asia/Dubai")).toBeNull();
  });
});

describe("toYmd", () => {
  test("keeps the day of a DATE or timestamp string", () => {
    expect(toYmd("2026-09-26")).toBe("2026-09-26");
    expect(toYmd("2026-09-26T10:00:00Z")).toBe("2026-09-26");
  });

  test("anything else is null", () => {
    expect(toYmd("20266-09-02")).toBeNull();
    expect(toYmd("26-09-2026")).toBeNull();
    expect(toYmd("")).toBeNull();
    expect(toYmd(null)).toBeNull();
    expect(toYmd(undefined)).toBeNull();
  });
});

describe("formatting", () => {
  test("formatDate reads like 'Sat, 26 Sep 2026' (Sep, not Sept; no zero padding)", () => {
    expect(formatDate("2026-09-26")).toBe("Sat, 26 Sep 2026");
    expect(formatDate("2026-10-05")).toBe("Mon, 5 Oct 2026");
  });

  test("formatDateRange shows the year once within a year, twice across years", () => {
    expect(formatDateRange("2026-09-18", "2026-09-24")).toBe("Fri, 18 Sep – Thu, 24 Sep 2026");
    expect(formatDateRange("2026-12-28", "2027-01-03")).toBe("Mon, 28 Dec 2026 – Sun, 3 Jan 2027");
  });
});
