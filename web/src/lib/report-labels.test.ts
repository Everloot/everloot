import { expect, test } from "vitest";
import { confirmedLine, dayLabel } from "./report-labels";
import { PLACEHOLDER } from "./placeholder";

test("QA round 15: a reported day reads in the site's day form; a missing one keeps the placeholder", () => {
  expect(dayLabel("2026-10-20T11:00:00.000Z")).toBe("Oct 20, 2026");
  expect(dayLabel("2026-11-09")).toBe("Nov 9, 2026");
  expect(dayLabel(null)).toBe(PLACEHOLDER);
  expect(confirmedLine(3, "2026-10-20T11:00:00Z")).toBe("Confirmed by 3 installs, last seen Oct 20, 2026");
});
