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
  for (const text of ["Progression", "Guild progression score", "60", "cleared", "partial", "none", "5 of the roster", "40 of the roster", "size unknown", "not seen open yet", "Counts synced kills from every linked character in the armory roster"]) expect(html).toContain(text);
  expect(html).toContain("2 / 2 bosses");
  expect(html).not.toContain("no data from this character");
});

test("hub hook adds a public score board alongside the raid board only for positive readable scores", () => {
  expect(renderToStaticMarkup(<GuildProgressionBoard rows={[]} />)).toBe("");
  const html = renderToStaticMarkup(<GuildBoards gear={null} raids={{ rows: [], instance: null, open: false, unreachable: false }} region={null} progression={[{ region: "eu", slug: "invented-watch", name: "Invented Watch", score: 5 }]} />);
  expect(html).toContain("Guild progression");
  expect(html).toContain("synced kills");
  expect(html).toContain("Public guild progression");
  expect(html).toContain('href="/armory/eu/guilds/invented-watch"');
  expect(html).toContain('aria-labelledby="board-raids"');
});

test("only instances with a kill are listed; the rest fold behind one closed disclosure, and the notes print once", async () => {
  const rows = guildProgression([base], []);
  loader.mockResolvedValue({ score: 10, links: {}, instances: [
    { ...rows[0], id: 33, name: "Killed Keep", state: "partial", killed: 1 },
    { ...rows[0], id: 34, name: "Quiet Vault", state: "none", killed: 0 },
    { ...rows[0], id: 35, name: "Silent Spire", group: "Raids", state: "none", killed: 0 },
  ] });
  const html = renderToStaticMarkup(await GuildProgression({ members: [], region: "eu" }));
  const [open, folded] = html.split("<details");
  expect(open).toContain("Killed Keep");
  expect(open).not.toContain("Quiet Vault");
  expect(open).not.toContain(">Raids</h3>");
  expect(folded).toContain("2 instances with no kills yet");
  expect(folded).toContain("Quiet Vault");
  expect(folded).toContain("Silent Spire");
  expect(html).not.toContain("<details open");
  expect(html.match(/not a Blizzard release announcement/g)).toHaveLength(1);
});

test("a guild with no kills says so in one line above the folded list", async () => {
  const rows = guildProgression([base], []);
  loader.mockResolvedValue({ score: 0, links: {}, instances: [{ ...rows[0], state: "none", killed: 0 }] });
  const html = renderToStaticMarkup(await GuildProgression({ members: [], region: "eu" }));
  expect(html).toContain("No roster member has a synced kill yet.");
  expect(html).toContain("1 instance with no kills yet");
  expect(html.indexOf("No roster member has a synced kill yet.")).toBeLessThan(html.indexOf("<details"));
});
