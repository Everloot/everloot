import { LICENCE, SITE } from "@everloot/protocol";
import { itemFactsFromRecords } from "./drop-rollup.js";
import { itemPage, ITEM_AGREEMENT, type ItemFacts } from "./item-page.js";
import { loreUrls, moreLine } from "./page-urls.js";
import type { ReleaseSource } from "./release-db.js";
import { allTerms, contentTerms, respell, search, searchSomeWords, SOME_WORDS, type Respelling, type SearchHit } from "./search.js";
import { agreedNpcNames, npcPage, WORLD_AGREEMENT, worldFactsFromRecords, type WorldFacts } from "./world-pages.js";
import type { RecheckScope } from "./coverage.js";
import { claimAnswers, requestedPredicate, filesEvidence, filesNameWords, type FilesIndex } from "./files-evidence.js";

/**
 * answer_sources: the evidence behind a question, every piece with its source, licence and date, so
 * the client's model writes the answer and cites the pieces (docs/design/specs/2026-10-17-sourced-answers-design.md).
 * Observed facts come first (players' uploads, public after three installs agree), then curated facts
 * and the 2023 Warcraft Wiki. Nothing is fetched from other sites: the further-reading links are
 * search URLs built from the names in the question.
 */

export type EvidenceKind = "observed" | "curated" | "files" | "lore";

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
  /** The words read another way before the pages were found ("thunderbluff" as "thunder bluff"); said in the text only. */
  respelled?: Respelling[];
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

/** Archive gameplay statements cannot establish Forever predicates. */
export function evidenceAnswers(question: string, evidence: Evidence): boolean {
  if (/not available from permitted facts/i.test(evidence.claim)) return false;
  if (requestedPredicate(question)) return evidence.kind !== "lore" && claimAnswers(question, evidence.claim) && (evidence.kind !== "curated" || mentions(question, evidence.source.title));
  // Identity questions still need the named subject, rather than a search fallback mention.
  return /^(?:who|what) is\b|^qu[ié]+n es\b|^qu[eé] es\b/i.test(question.trim()) && (mentions(question, evidence.source.title) || mentions(question, evidence.claim.split(":")[0]!));
}

/**
 * What players observed about the names in the question: `found` holds the facts, `gaps` the names that have no
 * agreed fact yet ("unrecorded, not zero"), which answer nothing on their own and go after every other piece.
 */
function observedEvidence(
  question: string, facts: AnswerSourcesFacts, dataAsOf: string | null, zones: Readonly<Record<number, string>> = {},
): { found: Evidence[]; gaps: Evidence[] } {
  const out: Evidence[] = [];
  const gaps: Evidence[] = [];
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
      gaps.push({
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
        claim: zones[pin.mapId] ? `${name} was seen in ${zones[pin.mapId]} at ${pin.x}, ${pin.y}.` : `${name} was seen on map ${pin.mapId} at ${pin.x}, ${pin.y}.`,
        kind: "observed", source: { title: `${name} on Everloot`, url }, licence: LICENCE, asOf: dataAsOf, support: pin.reporters,
      });
    }
    if (page.pins.length === 0) {
      gaps.push({
        claim: `${name} is a known NPC; no position has reached three installs yet.`,
        kind: "observed", source: { title: `${name} on Everloot`, url }, licence: LICENCE, asOf: dataAsOf, support: WORLD_AGREEMENT,
      });
    }
  }
  // An observed fact's source is its page on the site, named only once three installs agree on the name.
  const withPage = (e: Evidence) => ({ ...e, url: e.source.url });
  return { found: out.map(withPage), gaps: gaps.map(withPage) };
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
async function knowledgeHits(
  db: ReleaseSource, question: string, limit: number, keep: ReadonlySet<string>,
): Promise<{ hits: SearchHit[]; some: boolean; text: string; respelled: Respelling[]; trainers: Set<number> }> {
  const seen = new Set<number>();
  const trainers = new Set<number>();
  const out: SearchHit[] = [];
  // The wiki's addon-API reference and its subpages (a guild's ship, a machinima's cast) answer no player's question
  // by sharing its words; they stay only when the question names them.
  const offTopic = (hit: SearchHit) => (/^API /.test(hit.name) || hit.name.includes("/")) && !mentions(question, hit.name);
  const add = (hits: SearchHit[]) => { for (const hit of hits) if (!seen.has(hit.id) && !offTopic(hit) && out.length < limit) { seen.add(hit.id); out.push(hit); } };
  // "where do I learn mining" asks for a trainer: the pages name them "an orc mining trainer", never "learn".
  const trainer = question.replace(/\b(?:learn|train)\b/giu, "trainer");
  // Fetched past the limit so the pages left out above do not shrink the answer.
  if (trainer !== question) {
    add(await search(db, trainer, limit + 5));
    for (const hit of out) trainers.add(hit.id);
  }
  add(await search(db, question, limit + 5));
  const names = question.match(/\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)*/gu) ?? [];
  // A standalone asking word or game name is not another entity in the question. Searching "What"
  // alone falls back to that literal word and introduces unrelated book and quest pages.
  for (const name of names) if (name.length >= 3 && !/^(?:who|what|which|where|when|why|how|show|tell|please|qué|quién|dónde|cómo|wow|forever|world|warcraft)$/iu.test(name)) add(await search(db, name, 3));
  // A hit whose title holds every asked word is the page asked about. Without one, the hits may have matched a typo
  // a page or two share ("scarlet monestary"), so the words are read again; a reading that changes nothing keeps them.
  const asked = contentTerms(question);
  const onTopic = out.some((hit) => { const words = new Set(allTerms(hit.name).split(" ")); return asked.every((t) => words.has(t)); });
  if (onTopic) return { hits: out, some: false, text: question, respelled: [], trainers };
  // First the words as the pages spell them ("thunderbluff zeppeling"), then some of the words.
  const fixed = await respell(db, question, keep);
  if (fixed) {
    const again = await search(db, fixed.text, limit + 5);
    if (again.length) {
      out.length = 0;
      seen.clear();
      add(again);
    }
    if (out.length && again.length) return { hits: out, some: false, text: fixed.text, respelled: fixed.changes, trainers };
  }
  if (out.length) return { hits: out, some: false, text: question, respelled: [], trainers };
  // The some-words line opens that answer alone (the in-game companion reads it there), so the reading is not said.
  add(await searchSomeWords(db, fixed?.text ?? question, limit + 5));
  return { hits: out, some: out.length > 0, text: fixed?.text ?? question, respelled: [], trainers };
}

/**
 * The evidence for a question. `facts` null means the corpus is not connected: lore still answers, and
 * the text says the observed layer is unrecorded, not empty.
 */
export async function answerSources(
  db: ReleaseSource, args: { question: string; limit: number }, facts: AnswerSourcesFacts | null, dataAsOf: string | null, files: FilesIndex | null = null,
): Promise<AnswerSources> {
  const asked = args.question.trim();
  const { hits: found, some, text: question, respelled, trainers } = await knowledgeHits(db, asked, args.limit, filesNameWords(files));
  // Players' and the files' names are matched in the question as asked and, when it was read another way, as read:
  // a name the 2023 pages lack is spelled right as typed.
  const readings = question === asked ? [asked] : [asked, question];
  const union = <T extends { claim: string }>(lists: T[][]): T[] => {
    const out: T[] = [];
    for (const e of lists.flat()) if (!out.some((o) => o.claim === e.claim)) out.push(e);
    return out;
  };
  const players = facts ? readings.map((q) => observedEvidence(q, facts, dataAsOf, files?.zones)) : [];
  const observed = union(players.map((p) => p.found));
  const gaps = union(players.map((p) => p.gaps));
  const pages = await loreUrls(db, found);
  const hits = found.map((hit) => loreEvidence(hit, pages.get(hit.id)));
  // The trainers a "where do I learn" question found answer it, whatever page its words name.
  const trainerPages = new Set(hits.filter((_, i) => trainers.has(found[i]!.id)));
  const curated = hits.filter((e) => e.kind === "curated");
  const loreHits = hits.filter((e) => e.kind === "lore");
  // Once a question names an article we found, keep that context instead of unrelated pages that
  // happen to mention it (a dungeon's musical or pet-battle edition, for example). Broad questions
  // without an exact named article keep their explicitly marked search fallback.
  const directLore = loreHits.filter((e) => mentions(question, e.source.title) || trainerPages.has(e));
  const lore = directLore.length ? directLore : loreHits;
  // What the game-data files say about the things the question names: ids and facts, labelled unconfirmed.
  // Observed facts first, then Everloot's own, then the files (current build), then the 2023 wiki. Observed and files
  // facts about the question's names are all kept; curated and wiki pages fill what the limit leaves. Last, a note for
  // each name nothing agreed is known about yet, so an answer says unrecorded rather than leaving it out.
  // A piece that answers the whole question (the dungeons for a level) leaves no room for pages that share its words;
  // a zone the question only mentions comes after the pages, in what room they leave.
  const pieces = union(readings.map((q) => filesEvidence(q, files, Math.max(args.limit, 30))))
    .sort((a, b) => Number(claimAnswers(asked, b.claim)) - Number(claimAnswers(asked, a.claim))).slice(0, args.limit);
  const plain = ({ role: _role, ...e }: (typeof pieces)[number]): Evidence => e;
  const answers = pieces.filter((e) => e.role === "answer").map(plain);
  const fromFiles = pieces.filter((e) => e.role === undefined).map(plain);
  const places = pieces.filter((e) => e.role === "place").map(plain);
  const named = observed.length + answers.length + fromFiles.length;
  const fill = new Set(answers.length ? [] : [...curated, ...lore].sort((a, b) => Number(evidenceAnswers(asked, b)) - Number(evidenceAnswers(asked, a))).slice(0, Math.max(0, args.limit - named)));
  const room = Math.max(0, args.limit - named - fill.size);
  const evidence = [
    ...observed, ...curated.filter((e) => fill.has(e)), ...answers, ...fromFiles, ...lore.filter((e) => fill.has(e)), ...places.slice(0, room), ...gaps,
  ];
  if (requestedPredicate(asked)) evidence.sort((a, b) => Number(evidenceAnswers(asked, b)) - Number(evidenceAnswers(asked, a)));
  const predicate = requestedPredicate(asked);
  if (predicate && !evidence.some((e) => evidenceAnswers(asked, e))) {
    // Keep the wire shape stable. This is a limitation statement, never a gameplay value.
    evidence.push({ claim: `The requested ${predicate} is not available from permitted facts for this question. Subject matches are context only.`, kind: "curated", source: { title: "Everloot data policy", url: `${SITE}/methodology` }, licence: LICENCE, asOf: null });
  }
  // Observed and files facts answer the question's own names, so only an answer of fallback pages alone is marked.
  return {
    evidence, furtherReading: furtherReading(asked), dataAsOf,
    ...(some && named === 0 ? { someWords: true as const } : {}),
    ...(respelled.length ? { respelled } : {}),
  };
}

/** `Read "thunderbluff" as "thunder bluff" and "zeppeling" as "zeppelin".` */
export function respelledLine(changes: readonly Respelling[]): string {
  // A name split before a lone "s" is a possessive typed without its apostrophe: "mankriks" is "mankrik's".
  const parts = changes.map((c) => `"${c.from}" as "${c.to.replace(/ s$/, "'s")}"`);
  return `Read ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]}.`;
}

const KIND_LABEL: Record<EvidenceKind, string> = { observed: "observed in play", curated: "curated", files: "game files, found in game files and unconfirmed", lore: "lore (Warcraft Wiki 2023, may differ in WoW: Forever)" };

/** `corpus`: true when player observations were read, false when none are connected, "unreachable" when the read failed. */
export function formatAnswerSources(result: AnswerSources, corpus: boolean | "unreachable"): string {
  const lines: string[] = [];
  const unavailable = result.evidence.find((e) => /not available from permitted facts/i.test(e.claim));
  if (result.someWords) lines.push(SOME_WORDS);
  else if (result.respelled?.length) lines.push(respelledLine(result.respelled));
  if (unavailable) lines.push(unavailable.claim);
  if (result.evidence.length === 0) lines.push("No evidence found for that question. Nothing here is invented: try other words or an exact name.");
  if (result.evidence.some((e) => e.kind === "lore")) lines.push("Archive lore is historical context, not confirmation of Forever gameplay. Do not infer recorded gameplay facts from it. Game-file facts remain unconfirmed; missing observations remain unrecorded.");
  const pages = new Set<string>();
  for (const e of result.evidence) {
    if (e === unavailable) continue;
    const support = e.support !== undefined ? `, ${e.support} installs` : "";
    lines.push(`- [${KIND_LABEL[e.kind]}${support}] ${e.claim}\n  Source: ${e.source.url} (${e.licence}${e.asOf ? `, as of ${e.asOf.slice(0, 10)}` : ""})`);
    // A lore piece's source is the wiki; its page on the site is listed beside it, once per page (the bosses of one
    // instance share its page). An observed piece's source already is its page.
    if (e.url && e.url !== e.source.url && !pages.has(e.url)) {
      pages.add(e.url);
      lines.push(`  ${moreLine(e.url)}`);
    }
  }
  if (corpus === "unreachable") lines.push("Player observations could not be read just now, so the observed layer is unknown for this answer, not empty.");
  else if (!corpus) lines.push("Player observations are not connected here, so the observed layer is unrecorded, not empty.");
  if (result.furtherReading.length) lines.push(`Further reading (links only, nothing fetched): ${result.furtherReading.map((l) => `${l.site} ${l.url}`).join(" | ")}`);
  return lines.join("\n");
}
