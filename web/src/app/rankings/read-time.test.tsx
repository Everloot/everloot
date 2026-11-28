import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { readAt } from "@/lib/armory";
import type { ArmoryBoardRow, ArmoryGuildRow } from "@/lib/armory-store";
import { GuildBoards } from "./leaderboards";
import { BoardValue } from "../armory/board-parts";
import { ArmoryCredit } from "../armory/parts";

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
  expect(html).toContain(`(${readAt(fetchedAt)}).`);
});

// QA round 12: the Characters board's credit line and the gear board's screen-reader text said "Read 2026-11-23 03:44 UTC"
// while the board values said "Read Nov 23, 2026, 03:44 UTC". Every read time on /rankings now comes from readLine.
test("every read time on the rankings boards uses one format, never the ISO form", () => {
  const fetchedAt = "2026-11-23T03:44:00.000Z";
  const board: ArmoryBoardRow = {
    rank: 1, value: 61, region: "eu", slug: "invented-hero", name: "Invented", surname: "Hero", class: "Mage", faction: "Alliance",
    ruleset: "Normal", guild: null, fetchedAt,
  } as unknown as ArmoryBoardRow;
  const guild: ArmoryGuildRow = {
    region: "eu", slug: "invented-watch", name: "Invented Watch", faction: "Horde", rulesetId: 1, ruleset: "Normal",
    memberCount: 40, membersRead: 30, averageItemLevel: 52.4, level60: 12, fetchedAt,
  };
  const html = [
    renderToStaticMarkup(<BoardValue row={board} metric="item-level" top={61} />),
    renderToStaticMarkup(<ArmoryCredit at={fetchedAt} />),
    renderToStaticMarkup(<GuildBoards gear={{ state: "ready", rows: [guild] }} raids={null} region={null} />),
  ];
  for (const h of html) {
    expect(h).toContain("Nov 23, 2026, 03:44 UTC");
    expect(h).not.toContain("2026-11-23 03:44");
  }
});

// QA round 13: the gear tooltip read "Average of the guild members read. Read Nov 23, …": one sentence now, the read time
// in brackets, in the same read-time form.
test("the guild gear tooltip says what the average covers and when, in one sentence", () => {
  const guild: ArmoryGuildRow = {
    region: "eu", slug: "invented-watch", name: "Invented Watch", faction: "Horde", rulesetId: 1, ruleset: "Normal",
    memberCount: 40, membersRead: 30, averageItemLevel: 52.4, level60: 12, fetchedAt: "2026-11-23T03:44:00.000Z",
  };
  const html = renderToStaticMarkup(<GuildBoards gear={{ state: "ready", rows: [guild] }} raids={null} region={null} />);
  expect(html).toContain("Average across the members the armory has read (Nov 23, 2026, 03:44 UTC).");
  expect(html).not.toContain("guild members read.");
  const unread = renderToStaticMarkup(<GuildBoards gear={{ state: "ready", rows: [{ ...guild, fetchedAt: null as unknown as string }] }} raids={null} region={null} />);
  expect(unread).toContain("Average across the members the armory has read. Read time unrecorded.");
});
