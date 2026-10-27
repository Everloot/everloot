import { CREDIT_LINE, LICENCE, SITE } from "@everloot/protocol";
import type { DB } from "./db.js";
import { itemFactsFromRecords } from "./drop-rollup.js";
import { itemPage, ITEM_AGREEMENT, type ItemFacts } from "./item-page.js";
import { loreUrls, moreLine } from "./page-urls.js";
import { search, searchSomeWords, SOME_WORDS, type SearchHit } from "./search.js";
import { agreedNpcNames, npcPage, WORLD_AGREEMENT, worldFactsFromRecords, type WorldFacts } from "./world-pages.js";
import type { RecheckScope } from "./coverage.js";

/**
 * answer_sources: the evidence behind a question, every piece with its source, licence and date, so
 * the client's model writes the answer and cites the pieces (docs/design/specs/2026-10-17-sourced-answers-design.md).
 * Observed facts come first (players' uploads, public after three installs agree), then curated facts
 * and the 2023 Warcraft Wiki. Nothing is fetched from other sites: the further-reading links are
 * search URLs built from the names in the question.
 */

export type EvidenceKind = "observed" | "curated" | "lore";

export interface Evidence {
  /** One short statement, in Everloot's words for observed facts; the source's own excerpt for lore. */
  claim: string;
  kind: EvidenceKind;
  source: { title: string; url: string };
  licence: string;
  /** The date the source was read, or when the observations were current. */
  asOf: string | null;
  /** Observed facts: how many installs reported it. */
  support?: number;
  /** The piece's page on everloot.app: the item or NPC page, or the indexed lore page. */
  url?: string;
}

export interface FurtherReading { site: string; url: string }

export interface AnswerSourcesFacts { items: ItemFacts; world: WorldFacts }

export interface AnswerSources {
  evidence: Evidence[];
  furtherReading: FurtherReading[];
  dataAsOf: string | null;
  /** Set when no page held every asked word and the lore is the pages with some of them; said in the text only. */
  someWords?: true;
}

/** The two fact sets the tool reads from the corpus, built once per corpus version like the other tools. */
export function answerSourcesFactsFromRecords(records: unknown[], recheck: readonly RecheckScope[] = []): AnswerSourcesFacts {
  return { items: itemFactsFromRecords(records, recheck), world: worldFactsFromRecords(records, recheck) };
}

const clean = (value: string) => value.trim().toLowerCase();

/** Names that enough installs agree on, keyed by id: the only names the tool will match in a question. */
function agreedNames(rows: { installId: string; id: number; name: string }[], agreement: number): Map<number, string> {
  const byId = new Map<number, Map<string, { label: string; installs: Set<string> }>>();
  for (const row of rows) {
    const key = clean(row.name);
    if (!row.installId.trim() || !key) continue;
    const groups = byId.get(row.id) ?? new Map();
    const group = groups.get(key) ?? { label: row.name.trim(), installs: new Set<string>() };
    group.installs.add(row.installId);
    groups.set(key, group);
    byId.set(row.id, groups);
  }
  const out = new Map<number, string>();
  for (const [id, groups] of byId) {
    const winners = [...groups.values()].filter((g) => g.installs.size >= agreement);
    if (winners.length === 1) out.set(id, winners[0]!.label);
  }
  return out;
}

/** Whole-word, case-insensitive: "spider" does not match "Forest Spiderling". */
function mentions(question: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(question);
}

function firstSentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  const end = trimmed.search(/[.!?](\s|$)/);
  return end === -1 ? trimmed.slice(0, 240) : trimmed.slice(0, end + 1);
}

function loreEvidence(hit: SearchHit, url: string | undefined): Evidence {
  const curated = hit.sourceId.startsWith("curated");
  return {
    claim: `${hit.name}: ${firstSentence(hit.snippet)}`,
    kind: curated ? "curated" : "lore",
    source: { title: hit.name, url: hit.sourceUrl },
    licence: hit.licence,
    asOf: hit.retrievedAt,
    ...(url ? { url } : {}),
  };
}

const pct = (rate: number) => `${Math.round(rate * 1000) / 10}%`;

function observedEvidence(question: string, facts: AnswerSourcesFacts, dataAsOf: string | null): Evidence[] {
  const out: Evidence[] = [];
  const itemNames = agreedNames(facts.items.names.map((n) => ({ installId: n.installId, id: n.itemId, name: n.name })), ITEM_AGREEMENT);
  for (const [itemId, name] of itemNames) {
    if (!mentions(question, name)) continue;
    const page = itemPage(itemId, facts.items);
    const url = `${SITE}/database/items/${itemId}`;
    for (const drop of page.drops.slice(0, 5)) {
      out.push({
        claim: `${name} dropped from ${drop.source} in ${drop.drops} of ${drop.kills} loot windows players opened (${pct(drop.rate)}).`,
        kind: "observed", source: { title: `${name} on Everloot`, url }, licence: LICENCE, asOf: dataAsOf, support: drop.reporters,
      });
    }
    if (page.drops.length === 0) {
      out.push({
        claim: `${name} is a known item; no drop source has reached three installs yet, which is unrecorded, not zero.`,
        kind: "observed", source: { title: `${name} on Everloot`, url }, licence: LICENCE, asOf: dataAsOf, support: ITEM_AGREEMENT,
      });
    }
  }
  const npcNames = agreedNpcNames(facts.world);
  for (const [npcId, name] of npcNames) {
    if (!mentions(question, name)) continue;
    const page = npcPage(npcId, facts.world);
    const url = `${SITE}/database/npcs/${npcId}`;
    for (const pin of page.pins.slice(0, 3)) {
      out.push({
        claim: `${name} was seen on map ${pin.mapId} at ${pin.x}, ${pin.y}.`,
        kind: "observed", source: { title: `${name} on Everloot`, url }, licence: LICENCE, asOf: dataAsOf, support: pin.reporters,
      });
    }
    if (page.pins.length === 0) {
      out.push({
        claim: `${name} is a known NPC; no position has reached three installs yet.`,
        kind: "observed", source: { title: `${name} on Everloot`, url }, licence: LICENCE, asOf: dataAsOf, support: WORLD_AGREEMENT,
      });
    }
  }
  // An observed fact's source is its page on the site, named only once three installs agree on the name.
  return out.map((e) => ({ ...e, url: e.source.url }));
}

/** Search links on other sites, built from the question. Links only: nothing is fetched. */
export function furtherReading(question: string): FurtherReading[] {
  const q = encodeURIComponent(question.trim().slice(0, 100));
  if (!q) return [];
  return [
    { site: "Warcraft Wiki", url: `https://warcraft.wiki.gg/index.php?search=${q}` },
    { site: "Wowhead", url: `https://www.wowhead.com/search?q=${q}` },
    { site: "Icy Veins", url: `https://www.icy-veins.com/search/?q=${q}` },
  ];
}

/**
 * Lore and curated hits for the question as a whole, then for each name in it on its own, so a
 * question that names two things ("Peacebloom and Thrall") still finds both pages. Deduplicated by id.
 * When neither finds a page, the pages with some of the question's words, marked `some`.
 */
function knowledgeHits(db: DB, question: string, limit: number): { hits: SearchHit[]; some: boolean } {
  const seen = new Set<number>();
  const out: SearchHit[] = [];
  const add = (hits: SearchHit[]) => { for (const hit of hits) if (!seen.has(hit.id) && out.length < limit) { seen.add(hit.id); out.push(hit); } };
  add(search(db, question, limit));
  const names = question.match(/\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)*/gu) ?? [];
  for (const name of names) if (name.length >= 3) add(search(db, name, 3));
  if (out.length) return { hits: out, some: false };
  add(searchSomeWords(db, question, limit));
  return { hits: out, some: out.length > 0 };
}

/**
 * The evidence for a question. `facts` null means the corpus is not connected: lore still answers, and
 * the text says the observed layer is unrecorded, not empty.
 */
export function answerSources(
  db: DB, args: { question: string; limit: number }, facts: AnswerSourcesFacts | null, dataAsOf: string | null,
): AnswerSources {
  const question = args.question.trim();
  const observed = facts ? observedEvidence(question, facts, dataAsOf) : [];
  const { hits: found, some } = knowledgeHits(db, question, args.limit);
  const pages = loreUrls(db, found);
  const hits = found.map((hit) => loreEvidence(hit, pages.get(hit.id)));
  const curated = hits.filter((e) => e.kind === "curated");
  const lore = hits.filter((e) => e.kind === "lore");
  const evidence = [...observed, ...curated, ...lore].slice(0, Math.max(args.limit, observed.length));
  // Observed facts answer the question's own names, so only an answer of fallback pages alone is marked.
  return { evidence, furtherReading: furtherReading(question), dataAsOf, ...(some && observed.length === 0 ? { someWords: true as const } : {}) };
}

const KIND_LABEL: Record<EvidenceKind, string> = { observed: "observed in play", curated: "curated", lore: "lore (Warcraft Wiki 2023, may differ in WoW: Forever)" };

export function formatAnswerSources(result: AnswerSources, corpusConnected: boolean): string {
  const lines: string[] = [];
  if (result.someWords) lines.push(SOME_WORDS);
  if (result.evidence.length === 0) lines.push("No evidence found for that question. Nothing here is invented: try other words or an exact name.");
  for (const e of result.evidence) {
    const support = e.support !== undefined ? `, ${e.support} installs` : "";
    lines.push(`- [${KIND_LABEL[e.kind]}${support}] ${e.claim}\n  Source: ${e.source.url} (${e.licence}${e.asOf ? `, as of ${e.asOf.slice(0, 10)}` : ""})`);
    // A lore piece's source is the wiki; its page on the site is listed beside it. An observed piece's source already is its page.
    if (e.url && e.url !== e.source.url) lines.push(`  ${moreLine(e.url)}`);
  }
  if (!corpusConnected) lines.push("Player observations are not connected here, so the observed layer is unrecorded, not empty.");
  if (result.furtherReading.length) lines.push(`Further reading (links only, nothing fetched): ${result.furtherReading.map((l) => `${l.site} ${l.url}`).join(" | ")}`);
  lines.push(`Credit observed facts as "${CREDIT_LINE}"; keep each lore source with its text.`);
  return lines.join("\n");
}
