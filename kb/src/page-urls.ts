import { SITE, type ChangeFilter, type TalentClass } from "@everloot/protocol";
import { previewPath } from "../../web/src/lib/talents/summary";
import { guildSlug } from "./guilds.js";
import { INDEXABLE_MIN_BODY, lorePath } from "./lore-slug.js";
import { releaseDb, type ReleaseSource } from "./release-db.js";
import { SOURCES } from "./sources.js";

/**
 * The everloot.app page that shows each kind of tool answer, so an assistant answering from Everloot can
 * send the reader to it and cite it. Every function gives an absolute URL, or undefined when the site has no
 * page for the answer or the page would be empty. The database pages' tests are their own robots rule
 * (web/src/lib/indexable.ts); an item page also counts once the game files list the item.
 */

const abs = (path: string) => `${SITE}${path}`;

/** A query string from the parameters that have a value, encoded the way the site's own links are. */
function query(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v).trim())}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/** The line a text answer ends its body with, before the data age and credit lines. */
export const moreLine = (url: string): string => `More: ${url}`;

/** The text with its More line, placed before a trailing credit line when the text ends with one. */
export function withMore(text: string, url: string | undefined, credit?: string): string {
  if (!url) return text;
  if (credit && text.endsWith(`\n${credit}`)) return `${text.slice(0, -credit.length - 1)}\n${moreLine(url)}\n${credit}`;
  return `${text}\n${moreLine(url)}`;
}

export const ITEMS_URL = abs("/database/items");
export const ECOSYSTEM_URL = abs("/addons/ecosystem");

// Whether each database page has a public fact from players on it. The pages' robots rule, the database
// sitemap and the links below all read these, so a page is linked, listed and indexed by one test.

export const itemHasFacts = (page: { name: string | null; drops: readonly unknown[]; pins: readonly unknown[] }): boolean =>
  Boolean(page.name || page.drops.length || page.pins.length);

export const npcHasFacts = (page: { name: string | null; pins: readonly unknown[] }): boolean => Boolean(page.name || page.pins.length);

export const questHasFacts = (page: { title: string | null; level: number | null; giverNpcId: number | null; turnInNpcId: number | null; rewards: readonly unknown[] }): boolean =>
  Boolean(page.title || page.level !== null || page.giverNpcId !== null || page.turnInNpcId !== null || page.rewards.length);

export const vendorHasFacts = (page: { offers: readonly unknown[] }): boolean => page.offers.length > 0;

export const objectHasFacts = (page: { drops: readonly unknown[]; zero: unknown; pins?: readonly unknown[] }): boolean => Boolean(page.drops.length || page.zero || page.pins?.length);

/**
 * An item's page: one with a public fact from players, or (`inGameFiles`) one for an item the game files
 * list, whose page shows its class, type, slot and quality from them before anyone has reported it.
 */
export function itemPageUrl(page: { itemId: number; name: string | null; drops: readonly unknown[]; pins: readonly unknown[] }, inGameFiles = false): string | undefined {
  return itemHasFacts(page) || inGameFiles ? abs(`/database/items/${page.itemId}`) : undefined;
}

/** An NPC's page, for an NPC already known to have an agreed name or pin. */
export const npcUrl = (npcId: number): string => abs(`/database/npcs/${npcId}`);

export function npcPageUrl(page: { npcId: number; name: string | null; pins: readonly unknown[] }): string | undefined {
  return npcHasFacts(page) ? npcUrl(page.npcId) : undefined;
}

export function questPageUrl(page: { questId: number; title: string | null; level: number | null; giverNpcId: number | null; turnInNpcId: number | null; rewards: readonly unknown[] }): string | undefined {
  return questHasFacts(page) ? abs(`/database/quests/${page.questId}`) : undefined;
}

export function vendorPageUrl(page: { vendorNpcId: number; offers: readonly unknown[] }): string | undefined {
  return vendorHasFacts(page) ? abs(`/database/vendors/${page.vendorNpcId}`) : undefined;
}

export function objectPageUrl(page: { objectId: number; drops: readonly unknown[]; zero: unknown; pins?: readonly unknown[] }): string | undefined {
  return objectHasFacts(page) ? abs(`/database/objects/${page.objectId}`) : undefined;
}

/**
 * One item's prices on one realm. Every market answer links through here, so the day the site gets
 * per-item price pages, this is the only line that changes.
 */
export function marketItemUrl(realm: string, itemId: number): string {
  return abs(`/tools/auctions${query({ realm, item: itemId })}`);
}

/** The map centred on a spot, as the NPC and item pages link it: x and y from 0 to 100, one decimal. */
export function mapSpotUrl(mapId: number, x: number, y: number): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  return abs(`/map?zone=${mapId}&x=${r(x)}&y=${r(y)}`);
}

export function professionsUrl(profession: string, fromSkill?: number, toSkill?: number): string {
  return abs(`/tools/professions${query({ profession, from: fromSkill, to: toSkill })}`);
}

export function collectionsUrl(params: { install: string; collection?: string; character?: string }): string {
  return abs(`/tools/collections${query({ collection: params.collection, install: params.install, character: params.character })}`);
}

export function guildBoardUrl(guild: string, realm: string): string {
  return abs(`/tools/guild-board${query({ guild, realm })}`);
}

/** A guild's page: /guilds/<realm>/<guild>, each the slug kb/src/guilds.ts makes. */
export function guildPageUrl(realm: string, guild: string): string {
  return abs(`/guilds/${encodeURIComponent(guildSlug(realm))}/${encodeURIComponent(guildSlug(guild))}`);
}

/** The guild ladder, for one instance and filters. */
export function guildsUrl(params: { instance?: number; realm?: string; faction?: string; q?: string } = {}): string {
  return abs(`/guilds${query(params)}`);
}

export function goldLedgerUrl(character: string, realm: string): string {
  return abs(`/tools/gold-ledger${query({ character, realm })}`);
}

/** The census page; it has one choice, the window, and week is its default. */
export function censusUrl(window: "week" | "launch"): string {
  return abs(`/census${window === "launch" ? "?window=launch" : ""}`);
}

/** The changes page with the same filter. It shows WoW: Forever unless asked for both games. */
export function changesUrl(filter: ChangeFilter, game?: "forever" | "classic"): string {
  return abs(`/changes${query({ show: filter === "all" ? undefined : filter, game: game === "forever" ? undefined : "all" })}`);
}

export function talentsUrl(classSlug: TalentClass): string {
  return abs(`/tools/talents/${classSlug}`);
}

/** The class's hub: who can be one, with racial traits, its guides and the pages to plan with. */
export function classUrl(classSlug: TalentClass): string {
  return abs(`/classes/${classSlug}`);
}

/** A build's own link: the calculator opened on the plan, with a preview card. */
export function talentBuildUrl(classSlug: string, code: string): string {
  return abs(previewPath(classSlug, code, null)!);
}

const PUBLISHABLE = Object.values(SOURCES).filter((s) => s.publishable).map((s) => s.id);

/**
 * The lore page of each record that has a full one on the site, by record id: a lore page from a
 * publishable source with enough text, not a redirect stub. Other records get none.
 */
export async function loreUrls(source: ReleaseSource, rows: readonly { id: number; extId: string; name: string; kind: string }[]): Promise<Map<number, string>> {
  const lore = rows.filter((r) => r.kind === "lore_page");
  if (lore.length === 0) return new Map();
  const ids = new Set((await releaseDb(source).all<{ id: number }>(
    `SELECT id FROM entities WHERE id IN (${lore.map(() => "?").join(",")}) AND kind = 'lore_page'
       AND source_id IN (${PUBLISHABLE.map(() => "?").join(",")}) AND length(body) >= ? AND instr(body, 'REDIRECT') = 0`,
    ...lore.map((r) => r.id), ...PUBLISHABLE, INDEXABLE_MIN_BODY,
  )).map((r) => r.id));
  return new Map(lore.filter((r) => ids.has(r.id)).map((r) => [r.id, abs(lorePath(r))]));
}
