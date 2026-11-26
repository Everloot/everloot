import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCompletion: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  // The lore link asks the agreed object names too (a name an object and an achievement share is no link): storage reads empty here.
  uploadStore: { loadCompletion: store.loadCompletion, loadCorpus: async () => ({ uploads: 0, records: [], dataAsOf: null }) },
}));
// The game files' achievements: one with text and a criterion, one with no criteria at all.
type FileAchievement = { title: string; points: number; description?: string; criteria: { text: string; amount?: number }[]; category?: number; icon?: number; faction?: "Horde" | "Alliance"; reward?: string; rewardItem?: number; statistic?: true };
const game = vi.hoisted(() => ({ achievements: {} as Record<string, FileAchievement> }));
// Adventure holds Eastern Kingdoms, as the files nest them.
const CATEGORIES = { "15596": { name: "Adventure" }, "14777": { name: "Eastern Kingdoms", parent: 15596 }, "15425": { name: "Do Not Display" } };
vi.mock("@/data/game-data/client-achievements", () => ({ get CLIENT_ACHIEVEMENTS() { return { build: { version: "1.15.8.70862" }, achievements: game.achievements, categories: CATEGORIES }; } }));
// The asset manifest lists one achievement's icon; the reward item has a tooltip.
const art = vi.hoisted(() => ({ assets: null as unknown, tips: new Map<number, unknown>() }));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => art.assets,
  loadItemTips: async () => art.tips,
}));
vi.mock("@/data/game-data/client-titles", () => ({ get CLIENT_TITLES() { return { titles: [] }; } }));
vi.mock("@/data/game-data/client-factions", () => ({ get CLIENT_FACTIONS() { return { factions: [] }; } }));
vi.mock("@/data/game-data/client-quest-lines", () => ({ get CLIENT_QUEST_LINES() { return { questLines: [] }; } }));
// No lore archive is open here, so the page shows no lore block.
vi.mock("@/lib/release", () => ({ getRelease: () => null }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
}));
// The copy button keeps its text in a click handler, which static markup does not carry: shown here as a block instead.
vi.mock("@/components/ui/OpenData", () => ({
  default: ({ text, jsonHref }: { text: string; jsonHref?: string }) => <p><button type="button">Copy for AI</button>{jsonHref ? <a href={jsonHref}>Raw JSON</a> : null}<pre data-open-data>{text}</pre></p>,
}));

import AchievementPage from "./page";
import { emptyCompletion, foldCompletion } from "@kb/completion-rollup";

const at = "2026-11-08T00:00:00Z";
let seq = 0;
const reported = (installId: string, fields: Record<string, unknown>) => ({ kind: "achievement_catalog", installId, eventId: `e:${++seq}`, capturedAt: at, ...fields });
// "Two Steps" with its full criteria list, as installs send it.
const twoSteps = { achievementId: 5, name: "Two Steps", categoryId: 2, category: "General", points: 5, criteriaCount: 2, criteria: [{ text: "Visit Goldshire", required: 1 }, { text: "Kill 12 Kobolds", required: 12 }] };
const loremaster = { achievementId: 50, name: "Loremaster", categoryId: 3, category: "Quests", points: 10, criteriaCount: 1, criteria: [{ text: "Elwynn", required: 1 }] };
const from = (n: number, fields: Record<string, unknown>) => ["one", "two", "three"].slice(0, n).map((i) => reported(`reporter-${i}`, fields));
const serve = (records: Record<string, unknown>[]) =>
  store.loadCompletion.mockResolvedValue({ state: foldCompletion(emptyCompletion(), [{ records, grants: [] }]), dataAsOf: at });

const html = async (id: string) => renderToStaticMarkup(await AchievementPage({ params: Promise.resolve({ id }) }));
const openData = (out: string) => (/<pre data-open-data="true">([\s\S]*?)<\/pre>/.exec(out)?.[1] ?? "").split("\n");
const confirmedLine = (out: string) => /<p data-confirmed-line="true"[^>]*>(.*?)<\/p>/.exec(out)?.[1] ?? "";
const factOf = (out: string, label: string) => new RegExp(`>${label}</dt><dd[^>]*>(.*?)</dd>`).exec(out)?.[1] ?? "";
const TRACK = "Track it in the Collections tool. Progress needs the addon&#x27;s completion tracker (on in a new install; older installs keep their choice) and an upload that shares your collection ownership.";

beforeEach(() => {
  seq = 0;
  art.assets = null;
  art.tips = new Map();
  game.achievements = {
    "50": { title: "Loremaster", points: 10, description: "Complete every zone.", criteria: [{ text: "Elwynn" }] },
    "684": { title: "Conqueror of the Lair", points: 10, criteria: [] },
  };
  serve(from(3, twoSteps));
});

test("a confirmed achievement: In short from its reported facts, the Collections link, the Confirmed line and Copy for AI", async () => {
  const out = await html("5-two-steps");
  expect(out).toContain("In short");
  expect(out).toContain("An achievement in General, 5 points, 2 criteria.");
  expect(out).toContain("The category, points and criteria count are as three installs reported them, and so is the criteria list.");
  expect(out).toMatch(/Three installs confirmed it \(last upload [^)]+\)\./);
  expect(out).toContain(TRACK);
  expect(factOf(out, "Track this")).toContain('href="/tools/collections"');
  expect(confirmedLine(out)).toContain("Confirmed: three installs reported this achievement identically");
  // The copy text: the name first, the page's own address last, and no criteria text (game text stays on the page).
  const text = openData(out);
  expect(text[0]).toBe("Two Steps (achievement 5)");
  expect(text.at(-1)).toBe("Source: https://everloot.app/database/achievements/5-two-steps");
  expect(text.join("\n")).not.toContain("Visit Goldshire");
  // No route serves an achievement as JSON, so no Raw JSON link.
  expect(out).not.toContain("Raw JSON");
});

test("an achievement only the game files know says so, counts no installs as agreeing, and copies no game text", async () => {
  const out = await html("50-loremaster");
  expect(out).toContain("An achievement, 10 points, 1 criterion.");
  expect(out).toContain("The name, points and criteria are from the game files of build 1.15.8.70862, unconfirmed.");
  expect(out).toMatch(/Not confirmed yet: 0 of 3 installs have sent it/);
  expect(confirmedLine(out)).toBe("Unconfirmed: the list&#x27;s Confirmed column counts an achievement once three installs report it identically.");
  expect(out).toContain('href="/tools/collections"');
  const text = openData(out).join("\n");
  expect(text).toMatch(/^Loremaster \(achievement 50\)\n/);
  expect(text).toMatch(/\nSource: https:\/\/everloot\.app\/database\/achievements\/50-loremaster$/);
  expect(text).not.toContain("Complete every zone.");
  expect(text).not.toContain("Elwynn");
});

// Three installs agree on the entry (name, category, points and 3 criteria) but each words the criteria differently, so no list is agreed.
const unlisted = (id: number, name: string) => ["one", "two", "three"].map((i) => reported(`reporter-${i}`, {
  achievementId: id, name, categoryId: 3, category: "Quests", points: 10, criteriaCount: 3,
  criteria: ["A", "B", "C"].map((t) => ({ text: `${t} by ${i}`, required: 1 })),
}));

test("a confirmed achievement whose criteria text nobody agreed on: the count is the players', the list is the game files'", async () => {
  serve(unlisted(50, "Loremaster"));
  const out = await html("50-loremaster");
  expect(out).toContain("An achievement in Quests, 10 points, 3 criteria.");
  expect(factOf(out, "Criteria")).toBe("3");
  expect(out).toContain("The category, points and criteria count are as three installs reported them; the criteria list is the game files&#x27; (build 1.15.8.70862), unconfirmed.");
  expect(out).not.toContain("and so is the criteria list");
  // The list on the page is the files' one criterion, not the three the installs sent.
  expect(out).toContain("Elwynn");
  expect(openData(out).join("\n")).not.toContain("by one");
});

test("a confirmed achievement with no agreed criteria text and none in the game files says the list is still to come", async () => {
  serve(unlisted(5, "Two Steps"));
  const out = await html("5-two-steps");
  expect(out).toContain("The category, points and criteria count are as three installs reported them; the criteria list shows once three installs report the same full list.");
  expect(factOf(out, "Criteria")).toBe("3");
  expect(out).not.toContain("the game files&#x27; (build");
});

test("an achievement two installs reported stays unconfirmed and says how many have sent it", async () => {
  serve([...from(3, twoSteps), ...from(2, loremaster)]);
  const out = await html("50-loremaster");
  expect(out).toMatch(/Not confirmed yet: 2 of 3 installs have sent it/);
  expect(confirmedLine(out)).toContain("2 of 3 installs have sent it so far.");
  expect(out).not.toContain("Three installs confirmed it");
});

test("an achievement with no criteria still shows In short, the link and the Confirmed line", async () => {
  const out = await html("684-conqueror-of-the-lair");
  expect(out).toContain("An achievement, 10 points, 0 criteria.");
  expect(out).toContain(TRACK);
  expect(confirmedLine(out)).toContain("Unconfirmed");
  expect(openData(out)[0]).toBe("Conqueror of the Lair (achievement 684)");
});

test("with the player rollup unreadable, confirmation is unrecorded, never unconfirmed", async () => {
  store.loadCompletion.mockResolvedValue({ state: null, dataAsOf: null, unreachable: true });
  const out = await html("50-loremaster");
  expect(out).toContain("Whether players confirmed it is unrecorded: player confirmations could not be read just now.");
  expect(confirmedLine(out)).toContain("Unrecorded");
  expect(out).not.toContain("Not confirmed yet");
});

test("an achievement page sits in the wide-screen entity layout, In short and Open data in its side column", async () => {
  const out = await html("5-two-steps");
  expect(out).toContain('class="entity-layout');
  const side = out.split("data-entity-sidebar")[1] ?? "";
  expect(side).toContain("In short");
  expect(side).toContain("data-open-data");
});

test("an achievement from the files: its icon, the category path linking the list's groups, and the side that can earn it", async () => {
  game.achievements["776"] = { title: "Explore Elwynn Forest", points: 0, criteria: [], category: 14777, icon: 236761, faction: "Alliance" };
  art.assets = { achievementIcons: new Map([[776, "https://a.test/icons/236761.webp"]]) };
  const out = await html("776-explore-elwynn-forest");
  expect(out).toContain('src="https://a.test/icons/236761.webp"');
  expect(out).toContain('href="/database/achievements?category=Adventure"');
  expect(out).toContain('href="/database/achievements?category=Eastern+Kingdoms"');
  expect(factOf(out, "Faction")).toBe("Alliance only");
  expect(out).toContain("An achievement in Eastern Kingdoms, 0 points, 0 criteria.");
  expect(out).toContain("The name, category, points and criteria are from the game files of build 1.15.8.70862, unconfirmed.");
});

test("rewards: the files' reward line and the reward item with its tooltip; no title, since the files link none", async () => {
  game.achievements["15637"] = { title: "The Immortal", points: 0, criteria: [], rewardItem: 191481, reward: "Earn 1 Legacy Point." };
  art.assets = { achievementIcons: new Map(), base: "https://a.test", version: "1.15.8.70862", label: "Found in game files, unconfirmed" };
  art.tips = new Map([[191481, { name: "Tabard of the Immortal", color: "#a335ee", quality: "Epic", icon: "https://a.test/icons/1.webp", lines: [], partial: false, why: [], label: "Found in game files, unconfirmed" }]]);
  const out = await html("15637-the-immortal");
  expect(out).toMatch(/<h2[^>]*>Rewards<\/h2>/);
  expect(out).toContain("Earn 1 Legacy Point.");
  expect(out).toMatch(/href="\/database\/items\/191481"[^>]*>(?:<[^>]*>)*Tabard of the Immortal/);
  expect(out).not.toContain("/database/titles/");
  // The reward line is game text: on the page, not in Copy for AI.
  expect(openData(out).join("\n")).not.toContain("Legacy Point");
});

test("an achievement with no reward in the files has no Rewards section", async () => {
  const out = await html("50-loremaster");
  expect(out).not.toMatch(/>Rewards<\/h2>/);
  expect(factOf(out, "Faction")).toBe("");
});

test("development leftovers have no page: the files' Do Not Display category and [DNT], UNUSED and <Hidden> titles", async () => {
  game.achievements["20133"] = { title: "[DNT] Self-Found Soul (Level 1)", points: 0, criteria: [] };
  game.achievements["19563"] = { title: "UNUSED Bael'Gar Defeated (Daily)", points: 0, criteria: [] };
  game.achievements["15578"] = { title: "<Hidden> Adventure Awaits", points: 0, criteria: [] };
  game.achievements["41008"] = { title: "Rune Learned - Shared Acquisition", points: 0, criteria: [], category: 15425 };
  for (const id of ["20133", "19563", "15578", "41008"]) await expect(html(id)).rejects.toThrow("NEXT_NOT_FOUND");
});

test("one point reads as one point, in the box and in short", async () => {
  game.achievements["900"] = { title: "Lone Step", points: 1, criteria: [] };
  const out = await html("900-lone-step");
  expect(out).toMatch(/<p>1 point<\/p>/);
  expect(out).toContain("An achievement, 1 point, 0 criteria.");
});
