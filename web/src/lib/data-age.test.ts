import { expect, test } from "vitest";
import { dataAgeLabel } from "./data-age";

test("a data time reads as a UTC minute", () => {
  expect(dataAgeLabel("2026-10-09T10:05:42.000Z")).toBe("Data as of Oct 9, 2026, 10:05 UTC");
});

test("a missing or malformed time is unrecorded, never now", () => {
  expect(dataAgeLabel(null)).toBe("Data age unrecorded");
  expect(dataAgeLabel(undefined)).toBe("Data age unrecorded");
  expect(dataAgeLabel("x")).toBe("Data age unrecorded");
});
