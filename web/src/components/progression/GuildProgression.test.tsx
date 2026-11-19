import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { guildProgression } from "@kb/guild-progression";
import type { ProgressionInstance } from "@kb/progression";
const loader = vi.hoisted(() => vi.fn());
vi.mock("@/lib/progression", () => ({ loadGuildProgression: loader }));
import GuildProgression from "./GuildProgression";
import GuildProgressionBoard from "./GuildProgressionBoard";
import { GuildBoards } from "@/app/rankings/leaderboards";

const base: ProgressionInstance = { id: 33, name: "Invented Keep", group: "Dungeons", typeKnown: true, unconfirmed: false, availability: "open", bosses: [{ id: 1, name: "Invented Warden" }, { id: 2, name: "Invented Sentinel" }] };
test("section renders score tile, privacy, threshold, availability and every guild state in the shared matrix", async () => {
  const rows = guildProgression([base], []);
  loader.mockResolvedValue({ score: 60, links: {}, instances: [
    { ...rows[0], state: "cleared", killed: 2 }, { ...rows[0], id: 34, state: "partial", killed: 1 },
    { ...rows[0], id: 35, state: "none", killed: 0, threshold: 40 },
    { ...rows[0], id: 36, state: "none", killed: 0, threshold: null, availability: "not seen open yet" },
  ] });
  const html = renderToStaticMarkup(await GuildProgression({ members: [], region: "eu" }));
  for (const text of ["Progression", "Guild progression score", "60", "cleared", "partial", "none", "5 of the roster", "40 of the roster", "size unknown", "not seen open yet", "Counts members who linked their character and allowed their kills to be shown; others count as not having the kill"]) expect(html).toContain(text);
  expect(html).toContain("2 / 2 bosses");
  expect(html).not.toContain("no data from this character");
});

test("hub hook adds a private score board alongside the raid board only for positive readable scores", () => {
  expect(renderToStaticMarkup(<GuildProgressionBoard rows={[]} />)).toBe("");
  const html = renderToStaticMarkup(<GuildBoards gear={null} raids={{ rows: [], instance: null, open: false, unreachable: false }} region={null} progression={[{ region: "eu", slug: "invented-watch", name: "Invented Watch", score: 5 }]} />);
  expect(html).toContain("Guild progression");
  expect(html).toContain("readable kills");
  expect(html).toContain("not a public guild ranking");
  expect(html).toContain('href="/armory/eu/guilds/invented-watch"');
  expect(html).toContain('aria-labelledby="board-raids"');
});
