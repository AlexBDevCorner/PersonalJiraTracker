import { describe, expect, it } from "vitest";
import { buildWeek, isSameWeek, shiftWeek, startOfWeek } from "./week";

describe("startOfWeek", () => {
  it("returns Monday for a mid-week date", () => {
    const start = startOfWeek(new Date(2026, 4, 6, 15, 30));

    expect(start).toEqual(new Date(2026, 4, 4));
  });

  it("treats Sunday as the final day of the Monday-first week", () => {
    const start = startOfWeek(new Date(2026, 4, 10, 9, 0));

    expect(start).toEqual(new Date(2026, 4, 4));
  });
});

describe("buildWeek", () => {
  it("builds seven ISO days and marks today", () => {
    const week = buildWeek(new Date(2026, 4, 6), new Date(2026, 4, 8, 12));

    expect(week.days.map((day) => day.isoDate)).toEqual([
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
      "2026-05-07",
      "2026-05-08",
      "2026-05-09",
      "2026-05-10",
    ]);
    expect(week.days.filter((day) => day.isToday).map((day) => day.isoDate)).toEqual([
      "2026-05-08",
    ]);
    expect(week.start).toEqual(new Date(2026, 4, 4));
    expect(week.end).toEqual(new Date(2026, 4, 10));
  });
});

describe("shiftWeek", () => {
  it("shifts from the current week start by whole weeks", () => {
    const shifted = shiftWeek(new Date(2026, 4, 7), -1);

    expect(shifted).toEqual(new Date(2026, 3, 27));
  });
});

describe("isSameWeek", () => {
  it("compares dates by Monday-first week", () => {
    expect(isSameWeek(new Date(2026, 4, 4), new Date(2026, 4, 10))).toBe(true);
    expect(isSameWeek(new Date(2026, 4, 4), new Date(2026, 4, 11))).toBe(false);
  });
});
