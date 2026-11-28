import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { readLine } from "@/lib/armory";
import type { ArmoryGuildRow } from "@/lib/armory-store";
import { GuildBoards } from "./leaderboards";

// QA round 11: the gear board's read time is worded like every other "Read" on the page (lib/armory.ts readLine),
// never an HTTP date ("Read Sun, 22 Nov 2026 16:20:01 GMT").
test("the guild gear board says when a guild was read in the site's one read-time format", () => {
  const fetchedAt = "2026-11-22T16:20:01.000Z";
  const row: ArmoryGuildRow = {
    region: "eu", slug: "invented-watch", name: "Invented Watch", faction: "Horde", rulesetId: 1, ruleset: "Normal",
    memberCount: 40, membersRead: 30, averageItemLevel: 52.4, level60: 12, fetchedAt,
  };
  const html = renderToStaticMarkup(<GuildBoards gear={{ state: "ready", rows: [row] }} raids={null} region={null} />);
  expect(html).not.toContain("GMT");
  expect(html).toContain(`${readLine(fetchedAt)}.`);
});
