import { expect, test } from "vitest";
import { timeAgo, utcDay, utcStamp } from "./time";

// The site's two date forms: a moment ("Nov 28, 2026, 03:11 UTC") and a day ("Nov 22, 2026"), both read in UTC.

test("a moment reads as month, day, year and the UTC minute", () => {
  expect(utcStamp("2026-11-28T03:11:42.000Z")).toBe("Nov 28, 2026, 03:11 UTC");
  expect(utcStamp("2026-11-09T14:05:00Z")).toBe("Nov 9, 2026, 14:05 UTC");
});

test("a day reads as month, day and year, from a time or a bare UTC day", () => {
  expect(utcDay("2026-11-22T23:59:00Z")).toBe("Nov 22, 2026");
  expect(utcDay("2026-11-20")).toBe("Nov 20, 2026");
  expect(utcDay("2027-01-03")).toBe("Jan 3, 2027");
});

test("a missing or malformed time gives null, never now", () => {
  for (const bad of [null, undefined, "", "x"]) {
    expect(utcStamp(bad)).toBeNull();
    expect(utcDay(bad)).toBeNull();
  }
});

test("the relative form is unchanged", () => {
  expect(timeAgo(0, 43 * 3_600_000)).toBe("43 h ago");
});
