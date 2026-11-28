/**
 * The name gap report: for each kind the database pages name from the game files and the wiki, where each id's
 * name comes from, and why the rest still print as "Item N", "Quest N" and so on. Every id gets one reason and
 * the route that fills it, so the remaining blanks point at the addon or at a source we do not have yet.
 *
 * It reads the same sources and applies the same rules as item-names.ts and game-names.ts, in memory: it writes
 * no ledger and no name file. Names players agree on (3 installs) come first on the pages, but they live in the
 * upload store, not on this machine, so the gap lists alone may show a blank that players already name on the site.
 *
 * "Names today" is the number a maintainer sizes the gap by: per kind, how many ids each source names (the game
 * files, the Warcraft Wiki, the local pfQuest baseline, the names 3 installs agree on), counted separately, out of
 * the ids the game files and the baseline list. Players' names and the baseline are read only when the caller
 * passes them; a source not read prints [?], never 0.
 *
 * The report lists ids and counts, never names: it holds every id of the build, released or not, and the
 * baseline's rows are not publishable (docs/DATA_POLICY.md), so it stays local.
 */
import { withHotfixes } from "./client-hotfixes.js";
import { readClientMeta, readClientRows } from "./client-snapshot.js";
import type { DB } from "./db.js";
import { itemFactsFromRecords } from "./drop-rollup.js";
import { mayShowSetName, mayShowSpellName } from "./game-name-rule.js";
import { shownQuestNames, wikiQuestTitles } from "./game-names.js";
import { mayShowName } from "./item-name-rule.js";
import { agreedItemNames } from "./item-page.js";
import { emptyLedger, fileNames, mergeLedger, tierOf, wikiNames, type Ledger } from "./item-names.js";
import type { TableReader } from "./talents/build-catalog.js";
import { agreedQuestTitles, worldFactsFromRecords } from "./world-pages.js";

export const NAME_GAPS_SCHEMA = "everloot.name-gaps/1";

/** What fills a blank. shown: a source names it. players: the addon's uploads, after 3 installs. none: no source yet. */
export type Route = "shown" | "players" | "none";
export const ROUTES: Route[] = ["shown", "players", "none"];

export interface Bucket { reason: string; route: Route; count: number; sample: number[] }
export interface KindGaps { kind: "item" | "quest" | "item_set" | "spell"; label: string; total: number; buckets: Bucket[] }

/**
 * Per kind, how many ids each source names, out of the ids either list holds. The sources overlap, so the four
 * counts do not add up: `any` counts an id once, if any source that was read names it. null: the source was not read.
 */
export interface KindCoverage {
  kind: KindGaps["kind"];
  label: string;
  /** Ids the game files list, ids the baseline lists (null: not read) and ids either lists, the denominator below. */
  listed: { files: number; baseline: number | null; either: number };
  named: { files: number; wiki: number; baseline: number | null; players: number | null; any: number };
}

/** When and from what the counts were taken. A source that was not read is null. */
export interface Counted {
  /** The day the client snapshot was extracted. */
  snapshot: string;
  wikiDump: string;
  baseline: { commit: string | null; retrievedAt: string | null } | null;
  uploads: { asOf: string | null } | null;
}

export interface NameGaps { schema: typeof NAME_GAPS_SCHEMA; build: string; kinds: KindGaps[]; coverage: KindCoverage[]; counted: Counted }

/** The local baseline's names by id. Items and quests only: pfQuest has no item sets or spells. */
export interface BaselineNames { commit: string | null; retrievedAt: string | null; items: Map<number, string>; quests: Map<number, string> }

/** The names 3 installs agree on, by id. Uploads carry item and quest names; none for sets or spells. */
export interface PlayerNames { asOf: string | null; items: Map<number, string>; quests: Map<number, string> }

/**
 * The `pfquest-classic` item and quest rows of a source database. The importer keeps only entries with an English
 * name that passed its junk rule, so every row here is named and the baseline's listed count is its named count.
 */
export function baselineNames(db: DB): BaselineNames {
  const out: BaselineNames = { commit: null, retrievedAt: null, items: new Map(), quests: new Map() };
  const rows = db.prepare("SELECT kind, ext_id AS extId, name, source_url AS url, retrieved_at AS at FROM entities WHERE source_id = 'pfquest-classic' AND kind IN ('item', 'quest')")
    .iterate() as Iterable<{ kind: "item" | "quest"; extId: string; name: string; url: string; at: string }>;
  for (const r of rows) {
    out.commit ??= /\/blob\/([0-9a-f]{40})\//.exec(r.url)?.[1] ?? null;
    if (!out.retrievedAt || r.at > out.retrievedAt) out.retrievedAt = r.at;
    (r.kind === "item" ? out.items : out.quests).set(Number(r.extId), r.name);
  }
  return out;
}

/** The item names and quest titles 3 installs agree on, from the upload records (`item_seen` and `quest`). */
export function playerNames(records: unknown[], asOf: string | null = null): PlayerNames {
  return { asOf, items: agreedItemNames(itemFactsFromRecords(records)), quests: agreedQuestTitles(worldFactsFromRecords(records)) };
}

/**
 * Counts each source's named ids inside the ids the game files and the baseline list. An id a source names that
 * neither list holds is not counted, so no count is larger than `either`.
 */
export function kindCoverage(
  kind: KindGaps["kind"], label: string,
  ids: { files: Iterable<number>; baseline: Iterable<number> | null; named: { files: Iterable<number>; wiki: Iterable<number>; baseline: Iterable<number> | null; players: Iterable<number> | null } },
): KindCoverage {
  const files = new Set(ids.files);
  const baseline = ids.baseline === null ? null : new Set(ids.baseline);
  const either = new Set([...files, ...(baseline ?? [])]);
  const within = (source: Iterable<number> | null) => (source === null ? null : new Set([...source].filter((id) => either.has(id))));
  const named = { files: within(ids.named.files)!, wiki: within(ids.named.wiki)!, baseline: within(ids.named.baseline), players: within(ids.named.players) };
  const any = new Set([...named.files, ...named.wiki, ...(named.baseline ?? []), ...(named.players ?? [])]);
  return {
    kind, label,
    listed: { files: files.size, baseline: baseline?.size ?? null, either: either.size },
    named: { files: named.files.size, wiki: named.wiki.size, baseline: named.baseline?.size ?? null, players: named.players?.size ?? null, any: any.size },
  };
}

const SAMPLE = 5;

/** Counts ids into buckets, listed by route and then size; each bucket keeps its lowest ids as a sample. */
function tally(kind: KindGaps["kind"], label: string, ids: Iterable<number>, classify: (id: number) => [string, Route]): KindGaps {
  const buckets = new Map<string, Bucket>();
  let total = 0;
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    total += 1;
    const [reason, route] = classify(id);
    const b = buckets.get(reason) ?? buckets.set(reason, { reason, route, count: 0, sample: [] }).get(reason)!;
    b.count += 1;
    if (b.sample.length < SAMPLE) b.sample.push(id);
  }
  const order = (b: Bucket) => ROUTES.indexOf(b.route);
  return { kind, label, total, buckets: [...buckets.values()].sort((a, b) => order(a) - order(b) || b.count - a.count) };
}

/** Items: every row of the build's Item table, by the ledger tier the item names file is written from. */
export function itemGaps(ledger: Ledger, build: string, ids: Iterable<number>): KindGaps {
  return tally("item", "Items", ids, (id) => {
    const { tier } = tierOf(ledger.items[String(id)], build);
    if (tier === "match") return ["files and wiki agree", "shown"];
    if (tier === "mismatch") return ["files and wiki differ (the files' name shows)", "shown"];
    if (tier === "files") return ["game files only", "shown"];
    if (tier === "wiki") return ["wiki only", "shown"];
    return ["no name in the files or the wiki", "players"];
  });
}

/** Quests: every id of the build's QuestV2 table, which holds no titles; the wiki's quest infoboxes give them. */
export function questGaps(build: string, questIds: number[], titles: Parameters<typeof shownQuestNames>[2]): KindGaps {
  const { file, mismatches } = shownQuestNames(build, questIds, titles, { name: "", url: "", licence: "" });
  const disagree = new Set(mismatches.map((m) => m.id));
  return tally("quest", "Quests", questIds, (id) => {
    if (disagree.has(id)) return ["wiki pages differ (the first one's title shows)", "shown"];
    if (file.names[String(id)]) return ["wiki title", "shown"];
    if (titles.has(id)) return ["wiki title a Forever source contradicts", "players"];
    return ["no wiki title (the game files hold none)", "players"];
  });
}

/** Item sets or spells: every row of the name table. */
export function fileNameGaps(kind: "item_set" | "spell", label: string, rows: ReadonlyMap<number, Record<string, unknown>>): KindGaps {
  return tally(kind, label, rows.keys(), (id) => {
    const raw = rows.get(id)?.Name_lang;
    return typeof raw === "string" && raw.trim() ? ["named in the game files", "shown"] : ["no name in the game files", "none"];
  });
}

/**
 * One report from a snapshot and a knowledge base file with the Warcraft Wiki dump. Reads only; writes nothing.
 * `baseline` and `players` are what the caller read from the local baseline database and the uploads; without
 * them those columns print [?].
 */
export function runNameGaps(opts: { snapshotPath: string; kbPath: string; baseline?: BaselineNames | null; players?: PlayerNames | null }): NameGaps {
  const meta = readClientMeta(opts.snapshotPath);
  const get: TableReader = (t) => {
    const rows = readClientRows(opts.snapshotPath, t);
    return rows.size ? rows : undefined;
  };
  const itemIds = [...(get("Item")?.keys() ?? [])];
  const questIds = [...readClientRows(opts.snapshotPath, "QuestV2").keys()];
  const sets = readClientRows(opts.snapshotPath, "ItemSet");
  const spells = readClientRows(opts.snapshotPath, "SpellName");
  if (!itemIds.length || !questIds.length || !sets.size || !spells.size) {
    throw new Error("the snapshot lacks Item, QuestV2, ItemSet or SpellName; run `client-extract --refresh` first");
  }
  const wiki = wikiNames(opts.kbPath);
  // The hotfix cache's rows for items the ItemSparse file lacks count as the game files', as item-names shows them.
  const files = fileNames(withHotfixes(get));
  const ledger = mergeLedger(emptyLedger(), { at: meta.extractedAt, build: meta.version, files, wikiDump: wiki.dump, wiki: wiki.names });
  const questTitles = wikiQuestTitles(opts.kbPath).titles;
  const baseline = opts.baseline ?? null, players = opts.players ?? null;
  const fileNamed = (rows: ReadonlyMap<number, Record<string, unknown>>, may: (id: number, name: string) => boolean) =>
    [...rows].filter(([id, row]) => typeof row.Name_lang === "string" && may(id, row.Name_lang.trim())).map(([id]) => id);
  const coverage = [
    kindCoverage("item", "Items", {
      files: itemIds, baseline: baseline && baseline.items.keys(),
      named: {
        files: [...files].filter(([id, f]) => mayShowName(id, f.name)).map(([id]) => id),
        wiki: [...wiki.names].filter(([id, pages]) => mayShowName(id, pages[0]!.name)).map(([id]) => id),
        baseline: baseline && baseline.items.keys(), players: players && players.items.keys(),
      },
    }),
    // QuestV2 holds no titles, so the game files name no quest: the wiki's titles are the site's source.
    kindCoverage("quest", "Quests", {
      files: questIds, baseline: baseline && baseline.quests.keys(),
      named: {
        files: [], wiki: Object.keys(shownQuestNames(meta.version, questIds, questTitles, { name: "", url: "", licence: "" }).file.names).map(Number),
        baseline: baseline && baseline.quests.keys(), players: players && players.quests.keys(),
      },
    }),
    // pfQuest has no item sets or spells, and uploads carry no names for them: only the files name them.
    kindCoverage("item_set", "Item sets", { files: sets.keys(), baseline: baseline && [], named: { files: fileNamed(sets, mayShowSetName), wiki: [], baseline: baseline && [], players: players && [] } }),
    kindCoverage("spell", "Spells", { files: spells.keys(), baseline: baseline && [], named: { files: fileNamed(spells, mayShowSpellName), wiki: [], baseline: baseline && [], players: players && [] } }),
  ];
  return {
    schema: NAME_GAPS_SCHEMA,
    build: meta.version,
    kinds: [
      itemGaps(ledger, meta.version, itemIds),
      questGaps(meta.version, questIds, questTitles),
      fileNameGaps("item_set", "Item sets", sets),
      fileNameGaps("spell", "Spells", spells),
    ],
    coverage,
    counted: {
      snapshot: meta.extractedAt.slice(0, 10), wikiDump: wiki.dump,
      baseline: baseline && { commit: baseline.commit, retrievedAt: baseline.retrievedAt },
      uploads: players && { asOf: players.asOf },
    },
  };
}

const ROUTE_TEXT: Record<Route, string> = {
  shown: "a source names it",
  players: "addon uploads, after 3 installs agree",
  none: "no source yet",
};

const UNKNOWN = "[?]";

/** "12 (50.0%)": the count and its share of the denominator; a share under 0.05% of a nonzero count reads "<0.1%", not 0.0%. */
const share = (n: number | null, of: number) => {
  if (n === null) return UNKNOWN;
  const tenths = of ? Math.round((n * 1000) / of) : 0;
  return `${n} (${n > 0 && tenths === 0 ? "<0.1" : (tenths / 10).toFixed(1)}%)`;
};

function formatCoverage(report: NameGaps): string[] {
  const { counted: c } = report;
  const baseline = c.baseline ? `pfQuest commit ${c.baseline.commit?.slice(0, 8) ?? UNKNOWN}, imported ${c.baseline.retrievedAt ?? UNKNOWN}` : "not read, so its columns are [?]";
  const uploads = c.uploads ? `uploads as of ${c.uploads.asOf?.slice(0, 10) ?? "local files, no corpus date"}` : "not read, so its column is [?]";
  const lines = [
    "## Names today",
    "",
    `How many ids carry a name, by source, out of the ids the game files list plus the ids the baseline lists ("In either"). Build ${report.build}, client snapshot extracted ${c.snapshot}; Warcraft Wiki dump ${c.wikiDump}; baseline ${baseline}; players: ${uploads}.`,
    "",
    "| Kind | In game files | In baseline | In either | Game files | Wiki | Baseline | Players | Any source | No name |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const k of report.coverage) {
    const d = k.listed.either, n = k.named;
    lines.push(`| ${k.label} | ${k.listed.files} | ${k.listed.baseline ?? UNKNOWN} | ${d} | ${share(n.files, d)} | ${share(n.wiki, d)} | ${share(n.baseline, d)} | ${share(n.players, d)} | ${share(n.any, d)} | ${share(d - n.any, d)} |`);
  }
  lines.push(
    "",
    "Method: a source names an id when it gives a name the site may show (the rules in kb/src/item-name-rule.ts and game-name-rule.ts). The columns after \"In either\" are shares of that column; the sources overlap, so they do not add up, and \"Any source\" counts an id once. The game files hold no quest titles (QuestV2 lists ids only), so the wiki is the quest source. The baseline keeps only entries with an English name that passed the importer's junk rule, so it names every id it lists; its names and ids are local and never published. Players' names are those 3 installs agree on; uploads carry no names for item sets or spells, and pfQuest has none. An id a source names that neither list holds is not counted. A [?] is a source that was not read, not a zero.",
    "",
  );
  return lines;
}

export function formatNameGaps(report: NameGaps): string {
  const lines = [
    `# Name gaps — build ${report.build}`,
    "",
    ...(report.coverage.length ? formatCoverage(report) : []),
    "Names the game files and the Warcraft Wiki give, under the rules in docs/DATA_POLICY.md. Names players agree on",
    "(3 installs) are not in the route table below: they live in the upload store and come first on the pages.",
    "",
    "| Kind | Ids | Shown | Players | No source |",
    "|---|---|---|---|---|",
  ];
  for (const k of report.kinds) {
    const n = (r: Route) => k.buckets.filter((b) => b.route === r).reduce((s, b) => s + b.count, 0);
    lines.push(`| ${k.label} | ${k.total} | ${ROUTES.map(n).join(" | ")} |`);
  }
  lines.push("", "Routes: " + ROUTES.map((r) => `${r} — ${ROUTE_TEXT[r]}`).join("; ") + ".");
  for (const k of report.kinds) {
    lines.push("", `## ${k.label}`, "", "| Reason | Route | Ids | Lowest ids |", "|---|---|---|---|");
    for (const b of k.buckets) lines.push(`| ${b.reason} | ${b.route} | ${b.count} | ${b.sample.join(", ")} |`);
  }
  return `${lines.join("\n")}\n`;
}
