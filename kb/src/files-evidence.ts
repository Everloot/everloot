/**
 * The game files as an evidence kind: what the committed game-data files (web/src/data/game-data) say about
 * the instances, bosses, zones, flight masters, mounts, achievements and talents a question names. Ids and
 * facts with a link to the page, never the files' own text: achievement descriptions and criteria stay on
 * the page, as docs/DATA_POLICY.md asks of game text through the API and MCP. Every piece is labelled
 * found in game files, unconfirmed, with its build. The question bank's eval asked for this: 87% of
 * achievement and 56% of mount questions resolved nowhere in the 2023 wiki
 * (docs/evals/question-eval-2026-10-27-aliases.md).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GAME_DATA_CREDIT, SITE, TALENT_CLASSES } from "@everloot/protocol";
import { CLIENT_LABEL } from "./edges.js";
import { slugify } from "./lore-slug.js";
import { expandAliases } from "./name-aliases.js";

export type FilesFactKind = "instance" | "boss" | "zone" | "flight" | "mount" | "achievement" | "talent";

export interface FilesFact {
  kind: FilesFactKind;
  name: string;
  /** One short statement of ids and facts, no file text. */
  claim: string;
  /** The everloot.app page that shows it, absolute; absent when none shows it yet. */
  url?: string;
}

export interface FilesIndex {
  /** The build the facts come from, as the files name it ("1.60.1.70634"). */
  build: string;
  /** When the files were read. */
  extractedAt: string | null;
  facts: FilesFact[];
}

/** The committed game-data files, already parsed; each optional, so the index grows as files land. */
export interface GameDataFiles {
  map?: unknown;
  encounters?: unknown;
  mounts?: unknown;
  achievements?: unknown;
  /** One catalog per class, keyed by its slug. */
  talents?: Readonly<Record<string, unknown>>;
}

const rec = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const segment = (id: number, name: string) => { const words = slugify(name); return words ? `${id}-${words}` : String(id); };

/** Builds the index from the parsed files. Facts are in file order, so the index is the same on every run. */
export function buildFilesIndex(files: GameDataFiles): FilesIndex {
  const facts: FilesFact[] = [];
  let build = "";
  let extractedAt: string | null = null;
  const stamp = (b: unknown) => {
    const r = rec(b);
    if (r && !build) { build = str(r.version); extractedAt = str(r.extractedAt) || null; }
  };

  const map = rec(files.map);
  stamp(map?.source);
  const zoneName = new Map<number, string>();
  const continents = new Map<number, string>();
  for (const c of arr(map?.continents)) { const r = rec(c); const id = num(r?.id); const name = str(r?.name); if (id !== undefined && name) continents.set(id, name); }
  for (const z of arr(map?.zones)) {
    const r = rec(z); const id = num(r?.uiMapId); const name = str(r?.name);
    if (id === undefined || !name) continue;
    zoneName.set(id, name);
    const continent = continents.get(num(r?.continentId) ?? -1);
    facts.push({ kind: "zone", name, claim: `${name}: a zone${continent ? ` of ${continent}` : ""}, in the game files.`, url: `${SITE}/database/zones/${segment(id, name)}` });
  }
  const encounters = rec(rec(files.encounters)?.instances);
  stamp(rec(files.encounters)?.build);
  const seenInstance = new Set<number>();
  for (const e of arr(map?.entrances)) {
    const r = rec(e); const id = num(r?.mapId); const name = str(r?.name);
    if (id === undefined || !name || seenInstance.has(id)) continue;
    seenInstance.add(id);
    const kind = r?.raid === true ? "raid" : r?.raid === false ? "dungeon" : "instance";
    const min = num(r?.minLevel); const max = num(r?.maxLevel);
    const level = min !== undefined && max !== undefined ? (min === max ? `level ${min}` : `levels ${min} to ${max}`) : "";
    const zone = zoneName.get(num(r?.uiMapId) ?? -1);
    const bosses = arr(encounters?.[String(id)]);
    const url = `${SITE}/database/instances/${segment(id, name)}`;
    // The count, not the encounters' names: no DATA_POLICY line yet allows game-file encounter names through the API
    // or MCP (raised with the maintainer 2026-10-29). The page lists them.
    facts.push({
      kind: "instance", name,
      claim: `${name}: a ${kind}${level ? `, ${level}` : ""}${zone ? `, entered from ${zone}` : ""}${bosses.length ? `; the files list ${bosses.length} encounters` : ""}.`,
      url,
    });
    bosses.forEach((b, i) => {
      const bossName = str(rec(b)?.name);
      if (bossName) facts.push({ kind: "boss", name: bossName, claim: `${bossName}: encounter ${i + 1} of ${bosses.length} in ${name}, in the game files.`, url });
    });
  }
  // A node in a zone the map holds back (unreleased, DATA_POLICY "held-back zones") is left out altogether, name and zone.
  const heldBack = new Set(arr(map?.heldBackZones).map((z) => num(rec(z)?.uiMapId)));
  for (const f of arr(map?.flightNodes)) {
    const r = rec(f); const name = str(r?.name).split(",")[0]!.trim();
    if (!name || heldBack.has(num(r?.uiMapId))) continue;
    const zone = zoneName.get(num(r?.uiMapId) ?? -1);
    facts.push({ kind: "flight", name, claim: `${name}: a flight master${zone ? ` in ${zone}` : ""}, in the game files.`, url: `${SITE}/map` });
  }

  const mounts = rec(files.mounts);
  stamp(mounts?.build);
  for (const [id, m] of Object.entries(rec(mounts?.mounts) ?? {})) {
    const r = rec(m); const name = str(r?.name);
    if (!name) continue;
    const riding = num(r?.ridingSkill); const spell = num(r?.spellId);
    facts.push({
      kind: "mount", name,
      claim: `${name}: a mount (id ${id})${riding ? `, riding skill ${riding}` : ""}${spell ? `, taught by spell ${spell}` : ""}, in the game files.`,
      url: `${SITE}/tools/collections?view=mounts`,
    });
  }

  const achievements = rec(files.achievements);
  stamp(achievements?.build);
  for (const [id, a] of Object.entries(rec(achievements?.achievements) ?? {})) {
    const r = rec(a); const title = str(r?.title);
    if (!title) continue;
    const points = num(r?.points) ?? 0; const criteria = arr(r?.criteria).length;
    facts.push({
      kind: "achievement", name: title,
      claim: `${title}: an achievement, ${points} points${criteria ? `, ${criteria} criteria` : ""}; the criteria text is on its page.`,
      url: `${SITE}/database/achievements/${segment(Number(id), title)}`,
    });
  }

  for (const [slug, catalog] of Object.entries(files.talents ?? {})) {
    const c = rec(catalog);
    stamp(c?.build);
    const className = str(c?.className) || slug;
    const classUrl = (TALENT_CLASSES as readonly string[]).includes(slug) ? `${SITE}/tools/talents/${slug}` : undefined;
    for (const tree of arr(c?.trees)) {
      const treeName = str(rec(tree)?.name);
      for (const node of arr(rec(tree)?.nodes)) for (const entry of arr(rec(node)?.entries)) {
        const r = rec(entry); const name = str(r?.name);
        if (!name) continue;
        const ranks = num(r?.maxRanks);
        facts.push({ kind: "talent", name, claim: `${name}: a ${className} talent${treeName ? ` in the ${treeName} tree` : ""}${ranks ? `, up to ${ranks} ranks` : ""}, in the game files.`, ...(classUrl ? { url: classUrl } : {}) });
      }
    }
  }
  return { build, extractedAt, facts };
}

const readJson = (path: string): unknown => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined);

/** The index from the files on disk (the kb commands); the site builds it from its imports instead. */
export function readFilesIndex(gameDataDir: string): FilesIndex {
  const talentsDir = join(gameDataDir, "talents");
  const talents: Record<string, unknown> = {};
  if (existsSync(talentsDir)) for (const f of readdirSync(talentsDir).filter((n) => n.endsWith(".json")).sort()) talents[f.replace(/\.json$/, "")] = readJson(join(talentsDir, f));
  return buildFilesIndex({
    map: readJson(join(gameDataDir, "map.json")),
    encounters: readJson(join(gameDataDir, "client-encounters.json")),
    mounts: readJson(join(gameDataDir, "client-mounts.json")),
    achievements: readJson(join(gameDataDir, "client-achievements.json")),
    talents,
  });
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (question: string, name: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(question);

/** The evidence shape answer_sources returns, built here so the two files agree on the label and the source. */
export interface FilesEvidence {
  claim: string;
  kind: "files";
  source: { title: string; url: string };
  licence: string;
  asOf: string | null;
  url?: string;
}

/**
 * The facts whose names the question mentions as whole words, longest names first so "Blackrock Depths"
 * wins over "Blackrock" and a boss named like its instance is not counted twice; at most `limit`.
 */
export function filesEvidence(question: string, index: FilesIndex | null, limit: number): FilesEvidence[] {
  if (!index || !index.facts.length || limit <= 0) return [];
  // "where is BRD" names Blackrock Depths: the short forms expand before the facts are matched, as in search.
  const q = expandAliases(question.trim()).text;
  if (!q) return [];
  const matched = index.facts.filter((f) => f.name.length >= 3 && mentions(q, f.name));
  matched.sort((a, b) => b.name.length - a.name.length);
  const out: FilesEvidence[] = [];
  const seen = new Set<string>();
  for (const f of matched) {
    // One per thing, not per name: a talent two classes share is two facts, and both are the answer.
    if (seen.has(f.claim)) continue;
    seen.add(f.claim);
    out.push({
      claim: f.claim, kind: "files",
      source: { title: `WoW: Forever game files, build ${index.build || "unrecorded"} (${CLIENT_LABEL})`, url: `${SITE}/database/download` },
      licence: GAME_DATA_CREDIT, asOf: index.extractedAt,
      ...(f.url ? { url: f.url } : {}),
    });
    if (out.length >= limit) break;
  }
  return out;
}
