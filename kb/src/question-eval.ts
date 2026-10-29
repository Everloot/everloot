/**
 * The question eval: runs the question bank through the lookups the MCP tools and the chat use (`getByName`,
 * `search`, `answerSources`) with no model in the loop, and reports what resolves, what comes back with
 * evidence, and what does not. The report is the demand signal for the next data wave and the regression
 * check for retrieval changes (docs/design/specs/2026-10-27-question-bank-design.md).
 */
import { answerSources, type AnswerSourcesFacts, type EvidenceKind } from "./answer-sources.js";
import type { FilesIndex } from "./files-evidence.js";
import type { Question, SubjectKind } from "./question-bank.js";
import { sameTitle } from "./name-aliases.js";
import type { ReleaseSource } from "./release-db.js";
import { getByName, search, searchSomeWords } from "./search.js";

/** How the subject's name met a record: by its exact title, through search on the question, or not at all. */
export type Resolution = "exact" | "search" | "none" | "n/a";

export interface QuestionResult {
  id: string;
  template: string;
  kind: SubjectKind;
  resolution: Resolution;
  /** How many pieces of evidence answer_sources returned, and of which kinds. */
  evidence: number;
  evidenceKinds: EvidenceKind[];
  /** True when at least one piece points at an everloot.app page. */
  page: boolean;
  /** For a question with an answer key: the key's facts that no piece of evidence carries. Empty means all are there. */
  missingFacts?: string[];
}

export interface EvalRow { label: string; questions: number; exact: number; search: number; none: number; withEvidence: number; withObserved: number; withFiles: number; withPage: number; withKey: number; keyFound: number }

export interface EvalReport {
  schema: "everloot.question-eval/1";
  release: string;
  corpusConnected: boolean;
  dataAsOf: string | null;
  ranAt: string;
  totals: EvalRow;
  byTemplate: EvalRow[];
  byKind: EvalRow[];
  /** The subjects that did not resolve, per kind, the first few names each: the gap list a wave should close. */
  unresolved: { kind: SubjectKind; count: number; names: string[] }[];
  /** Questions that came back with no evidence at all, the first few per template. */
  noEvidence: { template: string; count: number; texts: string[] }[];
  /** Questions with an answer key whose evidence lacks some of its facts, the first few per template with what was missing. */
  keyMissing: { template: string; count: number; examples: { text: string; missing: string[] }[] }[];
  results: QuestionResult[];
}

/** The same title with or without its article: "The Barrens" asked, "Barrens" on the page. */
const sameName = sameTitle;

/**
 * The subject's name resolved exactly, or a search on the question text returns a record carrying that name.
 * An alias is scored on its text alone: the question is whether "MC" leads to Molten Core, not whether Molten
 * Core has a page.
 */
export async function resolve(db: ReleaseSource, q: Question): Promise<Resolution> {
  if (!q.expects.resolve) return "n/a";
  if (q.template !== "alias" && (await getByName(db, q.subject.name)).length > 0) return "exact";
  // The same two steps search_knowledge takes: pages with every asked word, else pages with some of them.
  const hits = await search(db, q.text, 5);
  return (hits.length ? hits : await searchSomeWords(db, q.text, 5)).some((h) => sameName(h.name, q.subject.name)) ? "search" : "none";
}

/** Typographic apostrophes and quotes as the plain ones the game files use: a model writes "Zul’Farrak". */
const plainQuotes = (s: string) => s.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');

/**
 * A fact as a whole word or number in the text, any case, curly or straight apostrophes: "75" is not found in "175".
 * A word fact may take a plural ending ("Druids" carries "Druid"); a number may not.
 */
export function carries(text: string, fact: string): boolean {
  const plain = plainQuotes(fact);
  const escaped = plain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const plural = /\p{L}$/u.test(plain) ? "(?:e?s)?" : "";
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}${plural}(?![\\p{L}\\p{N}])`, "iu").test(plainQuotes(text));
}

export async function evaluateQuestion(db: ReleaseSource, q: Question, facts: AnswerSourcesFacts | null, dataAsOf: string | null, files: FilesIndex | null = null): Promise<QuestionResult> {
  const result = await answerSources(db, { question: q.text, limit: 8 }, facts, dataAsOf, files);
  const kinds = [...new Set(result.evidence.map((e) => e.kind))];
  const said = result.evidence.map((e) => `${e.claim}\n${e.source.title}`).join("\n");
  return {
    id: q.id, template: q.template, kind: q.subject.kind,
    resolution: await resolve(db, q),
    evidence: result.evidence.length, evidenceKinds: kinds,
    page: result.evidence.some((e) => Boolean(e.url)),
    ...(q.answer ? { missingFacts: q.answer.facts.filter((f) => !carries(said, f)) } : {}),
  };
}

function fold(label: string, rows: readonly QuestionResult[]): EvalRow {
  return {
    label, questions: rows.length,
    exact: rows.filter((r) => r.resolution === "exact").length,
    search: rows.filter((r) => r.resolution === "search").length,
    none: rows.filter((r) => r.resolution === "none").length,
    withEvidence: rows.filter((r) => r.evidence > 0).length,
    withObserved: rows.filter((r) => r.evidenceKinds.includes("observed")).length,
    withFiles: rows.filter((r) => r.evidenceKinds.includes("files")).length,
    withPage: rows.filter((r) => r.page).length,
    withKey: rows.filter((r) => r.missingFacts).length,
    keyFound: rows.filter((r) => r.missingFacts?.length === 0).length,
  };
}

function groupBy<K extends string>(rows: readonly QuestionResult[], key: (r: QuestionResult) => K): Map<K, QuestionResult[]> {
  const out = new Map<K, QuestionResult[]>();
  for (const r of rows) out.set(key(r), [...(out.get(key(r)) ?? []), r]);
  return out;
}

export async function evaluateBank(
  db: ReleaseSource, bank: readonly Question[], facts: AnswerSourcesFacts | null,
  meta: { release: string; dataAsOf: string | null; ranAt?: string; sampleNames?: number; files?: FilesIndex | null },
): Promise<EvalReport> {
  const results: QuestionResult[] = [];
  for (const q of bank) results.push(await evaluateQuestion(db, q, facts, meta.dataAsOf, meta.files ?? null));
  const byId = new Map(bank.map((q) => [q.id, q]));
  const sample = meta.sampleNames ?? 12;
  const unresolved = [...groupBy(results.filter((r) => r.resolution === "none"), (r) => r.kind)]
    .map(([kind, rows]) => ({ kind, count: new Set(rows.map((r) => byId.get(r.id)!.subject.name)).size, names: [...new Set(rows.map((r) => byId.get(r.id)!.subject.name))].slice(0, sample) }))
    .sort((a, b) => b.count - a.count);
  const noEvidence = [...groupBy(results.filter((r) => r.evidence === 0), (r) => r.template)]
    .map(([template, rows]) => ({ template, count: rows.length, texts: rows.slice(0, sample).map((r) => byId.get(r.id)!.text) }))
    .sort((a, b) => b.count - a.count);
  const keyMissing = [...groupBy(results.filter((r) => r.missingFacts?.length), (r) => r.template)]
    .map(([template, rows]) => ({ template, count: rows.length, examples: rows.slice(0, sample).map((r) => ({ text: byId.get(r.id)!.text, missing: r.missingFacts! })) }))
    .sort((a, b) => b.count - a.count);
  return {
    schema: "everloot.question-eval/1",
    release: meta.release, corpusConnected: facts !== null, dataAsOf: meta.dataAsOf, ranAt: meta.ranAt ?? new Date().toISOString(),
    totals: fold("all", results),
    byTemplate: [...groupBy(results, (r) => r.template)].map(([t, rows]) => fold(t, rows)),
    byKind: [...groupBy(results, (r) => r.kind)].map(([k, rows]) => fold(k, rows)),
    unresolved, noEvidence, keyMissing, results,
  };
}

const pct = (n: number, of: number) => (of === 0 ? "–" : `${Math.round((100 * n) / of)}%`);
const rowLine = (r: EvalRow) => {
  const resolvable = r.exact + r.search + r.none; // the rows that expected a resolution
  return `| ${r.label} | ${r.questions} | ${pct(r.exact, resolvable)} | ${pct(r.search, resolvable)} | ${pct(r.none, resolvable)} | ${pct(r.withEvidence, r.questions)} | ${pct(r.withObserved, r.questions)} | ${pct(r.withFiles, r.questions)} | ${pct(r.withPage, r.questions)} | ${pct(r.keyFound, r.withKey)} |`;
};

/** The report as the markdown the eval commits: totals, per template, per kind, then the gap lists. */
export function formatEvalReport(report: EvalReport): string {
  const head = "| | questions | exact | by search | unresolved | with evidence | with observed | with files | with page | answer in evidence |\n|---|---|---|---|---|---|---|---|---|---|";
  const lines = [
    `# Question eval, ${report.ranAt.slice(0, 10)}`,
    "",
    `Release \`${report.release}\`. Player observations ${report.corpusConnected ? `connected (data as of ${report.dataAsOf ?? "unrecorded"})` : "not connected: the observed layer is unrecorded, not empty"}.`,
    "Resolution: the subject's name met a record exactly, or through search on the question, or not at all. Evidence: what `answer_sources` returned; \"with files\" counts the game files' own facts (ids and facts, unconfirmed). Percentages of resolution are over the questions that expect one. \"Answer in evidence\": of the questions with an answer key (the facts the game-data files say a correct answer carries), how many got evidence carrying every one of them.",
    "",
    "## Totals",
    "",
    head, rowLine(report.totals),
    "",
    "## By template",
    "",
    head, ...report.byTemplate.map(rowLine),
    "",
    "## By subject kind",
    "",
    head, ...report.byKind.map(rowLine),
    "",
    "## Unresolved subjects (the gap list)",
    "",
    ...(report.unresolved.length ? report.unresolved.map((u) => `- **${u.kind}** (${u.count}): ${u.names.join(", ")}${u.count > u.names.length ? ", …" : ""}`) : ["- none"]),
    "",
    "## Questions with no evidence",
    "",
    ...(report.noEvidence.length ? report.noEvidence.map((n) => `- **${n.template}** (${n.count}): ${n.texts.map((t) => `"${t}"`).join(", ")}${n.count > n.texts.length ? ", …" : ""}`) : ["- none"]),
    "",
    "## Answers missing from the evidence",
    "",
    ...(report.keyMissing.length ? report.keyMissing.map((k) => `- **${k.template}** (${k.count}): ${k.examples.map((e) => `"${e.text}" lacks ${e.missing.join(", ")}`).join("; ")}${k.count > k.examples.length ? "; …" : ""}`) : ["- none"]),
    "",
  ];
  return lines.join("\n");
}
