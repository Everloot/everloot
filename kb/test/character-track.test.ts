import { describe, expect, it } from "vitest";
import { gearTrackPoints, trackDays } from "../src/character-track";

describe("character tracking", () => {
  it("dates a character's points by the day its gear was captured, in UTC, one per metric", () => {
    const points = gearTrackPoints({ linkId: "l1", capturedAt: "2026-11-05T23:30:00-02:00", level: 58, itemLevel: 51, gearScore: 49 }, "gear_score_v1");
    expect(points).toEqual([
      { link_id: "l1", day: "2026-11-06", metric: "level", value: 58, source: "owner_sync" },
      { link_id: "l1", day: "2026-11-06", metric: "item_level", value: 51, source: "owner_sync" },
      { link_id: "l1", day: "2026-11-06", metric: "gear_score", value: 49, source: "owner_sync", version: "gear_score_v1" },
    ]);
  });

  it("writes nothing for a capture time it cannot read", () => {
    expect(gearTrackPoints({ linkId: "l1", capturedAt: "not a time", level: 1, itemLevel: 1, gearScore: 1 }, "v")).toEqual([]);
  });

  it("puts a character's points into one row per day, oldest first, with a gap where a metric has no point", () => {
    expect(trackDays([
      { day: "2026-11-06", metric: "item_level", value: 55 },
      { day: "2026-11-05", metric: "gear_score", value: 48 },
      { day: "2026-11-05", metric: "item_level", value: 52 },
      { day: "2026-11-06", metric: "level", value: 60 },
      { day: "2026-11-06", metric: "honorable_kills", value: 3 },
    ])).toEqual([
      { day: "2026-11-05", itemLevel: 52, gearScore: 48 },
      { day: "2026-11-06", itemLevel: 55, gearScore: null },
    ]);
  });

  it("skips a day that has neither gear number and a value that is not a finite number", () => {
    expect(trackDays([
      { day: "2026-11-04", metric: "level", value: 60 },
      { day: "2026-11-05", metric: "item_level", value: "52" },
      { day: "2026-11-06", metric: "item_level", value: Number.NaN },
    ])).toEqual([{ day: "2026-11-05", itemLevel: 52, gearScore: null }]);
  });
});
