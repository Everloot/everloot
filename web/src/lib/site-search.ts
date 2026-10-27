import { tools, toolHref } from "@/data/tools";
import { allDocsPages } from "@/lib/docs/nav";
import { entityHref } from "@/components/EntityLink";
import { describe } from "../../../kb/src/item-taxonomy";
import { objectList } from "../../../kb/src/object-page";
import { achievementHref, chainHref, factionHref, loadCatalog, titleHref } from "./completion-lists";
import { CLIENT_TAXONOMY } from "./items";
import type { SearchHit } from "../../../kb/src/search";
import { classLabel } from "./class-context";
import { CLASSES } from "@/design/tokens";
import { loreSlug, MAX_QUERY, searchLore, searchLoreSomeWords, UNAVAILABLE } from "./lore";
import { loadNames, type Names } from "./names";
import { loadObjectFacts } from "./objects";
import { WORLD_MAP } from "./world-map";
import { zoneHref } from "./zones";

/**
 * One page the search found. `exact` is an exact id or an exact name: those lead their group, and the page.
 * Database rows carry their id; item rows the game files' quality (0 poor to 5 legendary) and type, when
 * the item is in the build.
 */
export interface SearchResult { label: string; href: string; note?: string; exact: boolean; id?: number; quality?: number | null; meta?: string }
export type SearchType = "class" | "item" | "npc" | "quest" | "object" | "achievement" | "faction" | "title" | "chain" | "zone" | "lore" | "tool" | "doc";
/** `total` counts every match; `results` holds the first `limit` of them. */
export interface SearchGroup { type: SearchType; heading: string; results: SearchResult[]; total: number }
export const GROUP_LIMIT = 8;
export const LORE_LIMIT = 5;

export const HEADINGS: Record<SearchType, string> = {
  class: "Classes", item: "Items", npc: "NPCs", quest: "Quests", object: "Objects", achievement: "Achievements", faction: "Factions", title: "Titles", chain: "Quest chains", zone: "Zones", lore: "Lore archive", tool: "Tools", doc: "Docs",
};
/** The lore group's heading when its pages hold only some of the asked words. */
export const LORE_SOME_WORDS = "Lore archive, some of your words";
const ORDER: SearchType[] = ["class", "item", "npc", "quest", "object", "achievement", "faction", "title", "chain", "zone", "lore", "tool", "doc"];
/** The types a search can be scoped to (`/search?q=…&in=item`); `in=lore` is the lore archive's own list. */
export const SCOPES = ["item", "npc", "quest", "object"] as const satisfies readonly SearchType[];
export type Scope = (typeof SCOPES)[number];
export const isScope = (v: unknown): v is Scope => (SCOPES as readonly unknown[]).includes(v);
/** 0 exact, 1 starts with, 2 contains, null no match; both sides lowercase. */
function rank(name: string, q: string): number | null {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  return name.includes(q) ? 2 : null;
}

/** Every match of `entries`, best first (exact name, then prefix, then contains, then alphabetical). */
function byName<T extends { name: string }>(entries: Iterable<T>, q: string): { entry: T; exact: boolean; r: number }[] {
  const hits: { entry: T; r: number; n: string }[] = [];
  for (const entry of entries) {
    const n = entry.name.toLowerCase();
    const r = rank(n, q);
    if (r !== null) hits.push({ entry, r, n });
  }
  return hits.sort((a, b) => a.r - b.r || a.n.localeCompare(b.n)).map((h) => ({ entry: h.entry, exact: h.r === 0, r: h.r }));
}

/** An id typed whole ("1234", "#1234"): the digits, else null. */
export function exactId(q: string): number | null {
  const m = q.match(/^#?([1-9]\d{0,8})$/);
  return m ? Number(m[1]) : null;
}

let itemRows: Map<number, (typeof CLIENT_TAXONOMY.items)[number]> | null = null;
/** The quality and type the game files give an item, for colouring its name; nothing for an id not in the build. */
function itemFacts(id: number): Pick<SearchResult, "quality" | "meta"> {
  itemRows ??= new Map(CLIENT_TAXONOMY.items.map((row) => [row[0], row]));
  const row = itemRows.get(id);
  if (!row) return {};
  const c = describe(CLIENT_TAXONOMY, row);
  return { quality: row[4], meta: [c.subclass?.name, c.slot?.name].filter(Boolean).join(" · ") || undefined };
}

const WORD = { item: "Item", npc: "NPC", quest: "Quest" } as const;

/** Exact id first (any id opens its page), then the agreed names that match, best first. */
function agreed(kind: "item" | "npc" | "quest", names: Map<number, string>, q: string, id: number | null): { results: (SearchResult & { r: number })[]; total: number } {
  const out: (SearchResult & { r: number })[] = [];
  const extra = (n: number) => (kind === "item" ? itemFacts(n) : {});
  if (id !== null) out.push({ label: names.get(id) ?? `${WORD[kind]} ${id}`, href: entityHref(kind, id), note: `id ${id}`, exact: true, id, r: -1, ...extra(id) });
  const rows = byName([...names].map(([n, name]) => ({ id: n, name })), q).filter(({ entry }) => entry.id !== id);
  for (const { entry, exact, r } of rows) out.push({ label: entry.name, href: entityHref(kind, entry.id), note: `id ${entry.id}`, exact, id: entry.id, r, ...extra(entry.id) });
  return { results: out, total: out.length };
}

/** An object is found by its id when it has public loot observations; its name is the agreed one, if any. */
async function objectById(id: number | null, names: Map<number, string>): Promise<SearchResult[]> {
  if (id === null) return [];
  const facts = await loadObjectFacts();
  return !facts.unreachable && objectList(facts).some((o) => o.objectId === id)
    ? [{ label: names.get(id) ?? `Object ${id}`, href: entityHref("object", id), note: `id ${id}`, exact: true, id }] : [];
}

/**
 * Everything the site knows by this name or id, grouped by type. Names are the ones players agree on, or
 * `names` when a page passes the ones it shows (never the API's caller); zones are the released ones on the map,
 * lore comes from the archive, tools from the tool list. A group with an exact id or name match comes first; an
 * empty group is left out. `only` keeps one database type; `limit` is the rows per group.
 */
export async function siteSearch(raw: string, { only, limit = GROUP_LIMIT, names: given }: { only?: Scope; limit?: number; names?: Names | Promise<Names> } = {}): Promise<SearchGroup[]> {
  const text = raw.trim().slice(0, MAX_QUERY);
  const q = text.toLowerCase();
  if (!q) return [];
  const id = exactId(q);
  const found = new Map<SearchType, { results: SearchResult[]; total: number; heading?: string }>();
  const want = (t: SearchType) => !only || only === t;

  // Neither read depends on the other. Scoped searches do not need the completion catalogue.
  const [names, catalog] = await Promise.all([given ?? loadNames(), only ? null : loadCatalog()]);
  for (const kind of ["item", "npc", "quest"] as const) if (want(kind)) found.set(kind, agreed(kind, names[`${kind}s`], q, id));
  if (want("object")) { const objects = await objectById(id, names.objects); found.set("object", { results: objects, total: objects.length }); }

  if (!only) {
    // Achievements, factions, titles and quest chains three players reported, by name or id; none when the rollup cannot be read.
    if (catalog) {
      const hit = (label: string, href: string, n: number, exact: boolean): SearchResult => ({ label, href, note: `id ${n}`, exact, id: n });
      const achievements = byName(catalog.achievements, q).map(({ entry, exact }) => hit(entry.name, achievementHref(entry.achievementId, entry.name), entry.achievementId, exact));
      const factions = byName(catalog.factions, q).map(({ entry, exact }) => hit(entry.name, factionHref(entry.factionId, entry.name), entry.factionId, exact));
      if (id !== null) {
        const a = catalog.achievements.find((x) => x.achievementId === id), f = catalog.factions.find((x) => x.factionId === id);
        if (a && !achievements.some((r) => r.id === id)) achievements.unshift(hit(a.name, achievementHref(id, a.name), id, true));
        if (f && !factions.some((r) => r.id === id)) factions.unshift(hit(f.name, factionHref(id, f.name), id, true));
      }
      found.set("achievement", { results: achievements, total: achievements.length });
      found.set("faction", { results: factions, total: factions.length });
      const titles = byName(catalog.titles, q).map(({ entry, exact }) => hit(entry.name, titleHref(entry.titleId, entry.name), entry.titleId, exact));
      const chains = byName(catalog.chains, q).map(({ entry, exact }) => hit(entry.name, chainHref(entry.questLineId, entry.name), entry.questLineId, exact));
      if (id !== null) {
        const t = catalog.titles.find((x) => x.titleId === id), c = catalog.chains.find((x) => x.questLineId === id);
        if (t && !titles.some((r) => r.id === id)) titles.unshift(hit(t.name, titleHref(id, t.name), id, true));
        if (c && !chains.some((r) => r.id === id)) chains.unshift(hit(c.name, chainHref(id, c.name), id, true));
      }
      found.set("title", { results: titles, total: titles.length });
      found.set("chain", { results: chains, total: chains.length });
    }

    const zones = byName(WORLD_MAP.zones.map((z) => ({ id: z.uiMapId, name: z.name })), q)
      .map(({ entry, exact }) => ({ label: entry.name, href: zoneHref(entry.id, entry.name), note: "zone", exact }));
    found.set("zone", { results: zones, total: zones.length });

    // A class named anywhere in the words ("best race for a warlock") leads to its page: guides, talents, who can play it.
    const words = new Set(q.split(/[^a-z]+/).flatMap((w) => [w, w.replace(/s$/, "")]));
    const classes = CLASSES.filter((slug) => words.has(slug))
      .map((slug) => ({ label: classLabel(slug), href: `/classes/${slug}`, note: "Guides, talents and who can play it", exact: q.replace(/s$/, "") === slug }));
    found.set("class", { results: classes, total: classes.length });

    const lore = searchLore(text, 1);
    if (lore !== UNAVAILABLE) {
      const loreHit = (h: SearchHit) => ({ label: h.name, href: `/lore/${loreSlug(h)}`, note: h.snippet, exact: h.name.toLowerCase() === q });
      const some = lore.hits.length ? [] : searchLoreSomeWords(text, LORE_LIMIT);
      if (lore.hits.length || some === UNAVAILABLE) {
        const hits = lore.hits.map(loreHit);
        found.set("lore", { results: hits.slice(0, LORE_LIMIT), total: hits.length });
      } else {
        found.set("lore", { results: some.map(loreHit), total: some.length, heading: LORE_SOME_WORDS });
      }
    }

    const matches = tools.flatMap((t) => {
      const hay = [t.title, t.shortTitle, ...t.keywords].map((s) => s.toLowerCase());
      const r = rank(t.title.toLowerCase(), q) ?? (hay.some((s) => s.includes(q)) ? 2 : null);
      return r === null ? [] : [{ label: t.title, href: toolHref(t), note: t.tagline, exact: r === 0 }];
    }).sort((a, b) => Number(b.exact) - Number(a.exact));
    found.set("tool", { results: matches, total: matches.length });

    // Docs pages by title, then by their one-line description.
    const docs = allDocsPages().flatMap((p) => {
      const r = rank(p.title.toLowerCase(), q) ?? (p.lede.toLowerCase().includes(q) ? 3 : null);
      return r === null ? [] : [{ label: p.title, href: p.href, note: p.lede, exact: r === 0, r }];
    }).sort((a, b) => a.r - b.r).map(({ r: _r, ...hit }) => hit);
    found.set("doc", { results: docs, total: docs.length });
  }

  return ORDER
    .map((type) => {
      const f = found.get(type) ?? { results: [], total: 0 };
      return { type, heading: f.heading ?? HEADINGS[type], results: f.results.slice(0, limit).map(strip), total: f.total };
    })
    .filter((g) => g.results.length > 0)
    .map((g, i) => ({ g, i, tier: tier(g) }))
    .sort((a, b) => a.tier - b.tier || a.i - b.i)
    .map(({ g }) => g);
}

/** The things a player meets in the game: their groups lead the page. */
const GAME: ReadonlySet<SearchType> = new Set(["item", "npc", "quest", "object", "zone"]);
const DATABASE: ReadonlySet<SearchType> = new Set([...GAME, "class", "achievement", "faction", "title", "chain"]);

/**
 * Where a group sits, lowest first; the order above within a tier. An exact name or id on a game entry leads,
 * then any other exact hit, then the game entries, then the rest of the database. The lore archive (Warcraft
 * Wiki copies) comes after every database group, even on an exact name: the Forever record comes first.
 */
function tier(g: SearchGroup): number {
  const exact = g.results.some((r) => r.exact);
  if (g.type === "lore") return 4;
  if (exact) return GAME.has(g.type) ? 0 : 1;
  return GAME.has(g.type) ? 2 : DATABASE.has(g.type) ? 3 : 5;
}

/** Drops the internal rank from a result. */
function strip(result: SearchResult & { r?: number }): SearchResult {
  const out = { ...result };
  delete out.r;
  return out;
}

/** One instant suggestion under a search box: an item, NPC, quest or object page. */
export interface Suggestion { type: Scope; id: number; label: string; href: string; quality?: number | null }
export const SUGGEST_LIMIT = 8;

/**
 * Up to 8 pages for a search box as the visitor types: an exact id first, then exact names, then names that
 * start with the text, then names that contain it, across items, NPCs, quests and objects (or one of them).
 * Names only where players agree on them, as on /search; no lore or tools, so it stays cheap per keystroke.
 */
export async function suggest(raw: string, scope?: Scope, names?: Names): Promise<Suggestion[]> {
  const q = raw.trim().slice(0, MAX_QUERY).toLowerCase();
  if (!q) return [];
  const id = exactId(q);
  const all = names ?? await loadNames();
  const order: Scope[] = scope ? [scope] : [...SCOPES];
  const ranked: { s: Suggestion; r: number; t: number }[] = [];
  for (const [t, type] of order.entries()) {
    if (type === "object") {
      for (const o of await objectById(id, all.objects)) ranked.push({ s: { type, id: o.id!, label: o.label, href: o.href }, r: -1, t });
      continue;
    }
    for (const x of agreed(type, all[`${type}s`], q, id).results.slice(0, SUGGEST_LIMIT)) {
      ranked.push({ s: { type, id: x.id!, label: x.label, href: x.href, ...(type === "item" ? { quality: x.quality ?? null } : {}) }, r: x.r, t });
    }
  }
  return ranked.sort((a, b) => a.r - b.r || a.t - b.t).slice(0, SUGGEST_LIMIT).map((x) => x.s);
}
