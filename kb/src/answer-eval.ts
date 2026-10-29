/**
 * The written-answer eval (question bank phase 2): a sample of the bank's questions that carry an answer key, each
 * sent with answer_sources' evidence to a model under the rules in-game /ask gives it, and the reply scored against
 * the key. Any OpenAI-compatible endpoint answers (a local Ollama or vLLM, OpenRouter, a team server); the eval sends
 * the question and the evidence, nothing about a player. It costs a model call per question, so it runs on demand,
 * never in CI (docs/design/specs/2026-10-27-question-bank-design.md, phase 2).
 */
import { answerSources, formatAnswerSources, type AnswerSourcesFacts } from "./answer-sources.js";
import type { FilesIndex } from "./files-evidence.js";
import type { Question } from "./question-bank.js";
import { carries } from "./question-eval.js";
import type { ReleaseSource } from "./release-db.js";

/** What the model is told: the in-game /ask rules (companion/src/bridge/llm-engine.ts), so the score is that path's. */
export const NOT_FOUND = "Not in the sources.";
export const ANSWER_SYSTEM = [
  "You answer a World of Warcraft: Forever player's question for a small in-game chat window.",
  "Use only the sources in the user message. If they do not answer the question, reply exactly: " + NOT_FOUND,
  "Answer in at most two sentences of plain text, without markdown.",
].join(" ");

/** correct: every key fact is in the reply; partial: some; declined: the model said the sources do not answer; wrong: none. */
export type Verdict = "correct" | "partial" | "declined" | "wrong" | "error";

export interface WrittenResult { id: string; template: string; text: string; facts: string[]; reply: string; verdict: Verdict; missing: string[] }

export interface AnswerEvalReport {
  schema: "everloot.answer-eval/1";
  model: string;
  /** Whether player observations joined the evidence, as they do for in-game /ask; without them that layer is unrecorded. */
  corpusConnected?: boolean;
  ranAt: string;
  sampled: number;
  totals: Record<Verdict, number>;
  byTemplate: { template: string; questions: number; correct: number; partial: number; declined: number; wrong: number; error: number }[];
  results: WrittenResult[];
}

/** One model call: system and user text in, the reply's text out. */
export type Complete = (system: string, user: string) => Promise<string>;

/**
 * An OpenAI-compatible /chat/completions caller, deterministic (temperature 0) and bounded. `maxTokens` must leave a
 * reasoning model room to answer after it thinks: an empty reply is an error, never scored as a wrong answer.
 */
export function openAiCompatible(o: { baseUrl: string; model: string; key?: string | null; maxTokens?: number; timeoutMs?: number; send?: typeof fetch }): Complete {
  const send = o.send ?? fetch;
  return async (system, user) => {
    const res = await send(`${o.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(o.key ? { authorization: `Bearer ${o.key}` } : {}) },
      body: JSON.stringify({ model: o.model, temperature: 0, max_tokens: o.maxTokens ?? 1500, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      signal: AbortSignal.timeout(o.timeoutMs ?? 120_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { choices?: { finish_reason?: unknown; message?: { content?: unknown } }[] };
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      throw new Error(body.choices?.[0]?.finish_reason === "length" ? "empty reply: the token budget ran out (raise --max-tokens)" : "no text in the reply");
    }
    return text;
  };
}

/** Every k-th keyed question, so the same sample comes back on every run of the same bank. */
export function sampleKeyed(bank: readonly Question[], size: number): Question[] {
  const keyed = bank.filter((q) => q.answer?.facts.length);
  const step = Math.max(1, Math.floor(keyed.length / Math.max(1, size)));
  return keyed.filter((_, i) => i % step === 0).slice(0, size);
}

export function score(reply: string, facts: readonly string[]): { verdict: Verdict; missing: string[] } {
  const missing = facts.filter((f) => !carries(reply, f));
  if (missing.length === 0) return { verdict: "correct", missing };
  // The refusal however the model ends it, as in-game /ask reads it (companion/src/bridge/llm-engine.ts).
  if (reply.trim().replace(/[.!\s]+$/, "").toLowerCase() === NOT_FOUND.replace(/\.$/, "").toLowerCase()) return { verdict: "declined", missing };
  return { verdict: missing.length < facts.length ? "partial" : "wrong", missing };
}

export async function evaluateWritten(
  db: ReleaseSource, sample: readonly Question[], complete: Complete,
  meta: { model: string; ranAt?: string; facts?: AnswerSourcesFacts | null; dataAsOf?: string | null; files?: FilesIndex | null },
): Promise<AnswerEvalReport> {
  const results: WrittenResult[] = [];
  for (const q of sample) {
    const facts = q.answer!.facts;
    const sources = await answerSources(db, { question: q.text, limit: 8 }, meta.facts ?? null, meta.dataAsOf ?? null, meta.files ?? null);
    let reply = "";
    let verdict: Verdict;
    let missing: string[] = [...facts];
    try {
      reply = (await complete(ANSWER_SYSTEM, `Question: ${q.text}\n\nSources:\n${formatAnswerSources(sources, meta.facts != null)}`)).trim();
      ({ verdict, missing } = score(reply, facts));
    } catch (err) {
      verdict = "error";
      reply = err instanceof Error ? err.message : String(err);
    }
    results.push({ id: q.id, template: q.template, text: q.text, facts, reply, verdict, missing });
  }
  const verdicts: Verdict[] = ["correct", "partial", "declined", "wrong", "error"];
  const tally = (rows: readonly WrittenResult[]) => Object.fromEntries(verdicts.map((v) => [v, rows.filter((r) => r.verdict === v).length])) as Record<Verdict, number>;
  const templates = [...new Set(results.map((r) => r.template))];
  return {
    schema: "everloot.answer-eval/1", model: meta.model, corpusConnected: meta.facts != null, ranAt: meta.ranAt ?? new Date().toISOString(), sampled: results.length,
    totals: tally(results),
    byTemplate: templates.map((template) => { const rows = results.filter((r) => r.template === template); return { template, questions: rows.length, ...tally(rows) }; }),
    results,
  };
}

const pct = (n: number, of: number) => (of === 0 ? "–" : `${Math.round((100 * n) / of)}%`);
const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\s+/g, " ");

export function formatAnswerEval(report: AnswerEvalReport, examples = 15): string {
  const row = (label: string, n: number, t: Record<Verdict, number>) =>
    `| ${label} | ${n} | ${pct(t.correct, n)} | ${pct(t.partial, n)} | ${pct(t.declined, n)} | ${pct(t.wrong, n)} | ${pct(t.error, n)} |`;
  const head = "| | questions | correct | partial | declined | wrong | error |\n|---|---|---|---|---|---|---|";
  const misses = report.results.filter((r) => r.verdict !== "correct");
  return [
    `# Written-answer eval, ${report.ranAt.slice(0, 10)}`,
    "",
    `Model \`${report.model}\`, ${report.sampled} questions with an answer key, each sent with answer_sources' evidence under the in-game /ask rules. Correct: the reply carries every fact of the key; partial: some; declined: the model said the sources do not answer; wrong: none. Player observations ${report.corpusConnected ? "connected, as for in-game /ask" : "not connected: the evidence has no observed pieces, unlike in-game /ask"}.`,
    "",
    "## Totals",
    "",
    head, row("all", report.sampled, report.totals),
    "",
    "## By template",
    "",
    head, ...report.byTemplate.map((t) => row(t.template, t.questions, t)),
    "",
    "## Answers that missed",
    "",
    ...(misses.length
      ? ["| question | expected | reply |", "|---|---|---|", ...misses.slice(0, examples).map((r) => `| ${cell(r.text)} | ${cell(r.missing.join(", "))} | ${cell(r.reply.slice(0, 200))} |`)]
      : ["None."]),
    ...(misses.length > examples ? ["", `…and ${misses.length - examples} more in the JSON.`] : []),
    "",
  ].join("\n");
}
