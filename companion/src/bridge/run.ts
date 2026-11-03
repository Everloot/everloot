import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readAsks, type Ask } from "./asks";
import { writeAnswersAddon, type Answer } from "./answers";
import { lookupText, MAX_ANSWER, readsAsFollowUp, withPlayer, type AnswerEngine, type Earlier } from "./engine";
import { readStateFile } from "../state-file";

/** Answers already given, kept in the companion's data folder (the newest 20 go back into the game). */
export function createAnswerStore(path: string, onRecovery: (message: string) => void = console.warn) {
  let answers = readStateFile(path, (value): value is Answer[] => Array.isArray(value) && value.every((row) =>
    row !== null && typeof row === "object" && [row.id, row.answer, row.source, row.answeredAt].every((field) => typeof field === "string")), onRecovery) ?? [];
  return {
    has: (id: string) => answers.some((a) => a.id === id),
    list: () => [...answers],
    add(answer: Answer) {
      answers = [...answers.filter((a) => a.id !== answer.id), answer].slice(-20);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(`${path}.tmp`, JSON.stringify(answers));
      renameSync(`${path}.tmp`, path);
    },
  };
}

export type AnswerStore = ReturnType<typeof createAnswerStore>;

/** How long after a question the next one can still lean on it. */
export const FOLLOW_UP_WINDOW_MS = 30 * 60_000;

/**
 * The question this ask follows, when it reads as a follow-up: the newest one answered before it, asked within the
 * window. The game's own times are compared, so a question answered late still counts.
 */
export function earlierFor(ask: Ask, answered: readonly Answer[]): Earlier | undefined {
  if (!readsAsFollowUp(ask.question)) return undefined;
  const last = [...answered].reverse().find((a) => a.id !== ask.id && typeof a.question === "string" && typeof a.askedAt === "string");
  if (!last) return undefined;
  const gap = Date.parse(ask.askedAt) - Date.parse(last.askedAt!);
  return gap >= 0 && gap <= FOLLOW_UP_WINDOW_MS ? { question: last.question!, answer: last.answer } : undefined;
}

/** Answer every new /ask in one SavedVariables file and rewrite the slot addon. Failures are shown, and retried next time. */
export async function answerPending(options: {
  /** The file's asks when the caller has read them already; otherwise `svFile` is read. */
  svFile: string; asks?: Ask[]; addonsDir: string; engine: AnswerEngine; store: AnswerStore; now?: () => Date;
}): Promise<{ answered: number; failed: number }> {
  const now = options.now ?? (() => new Date());
  const asks = options.asks ?? readAsks(readFileSync(options.svFile, "utf8"));
  const pending = asks.filter((a) => !options.store.has(a.id));
  if (pending.length === 0) {
    // An answered question is still queued in game: not read yet, or its checksum failed. Rewriting the
    // slot addon from the store is safe to repeat and heals a damaged file without a new model call.
    if (asks.length > 0) writeAnswersAddon(options.addonsDir, options.store.list());
    return { answered: 0, failed: 0 };
  }
  const failures: Answer[] = [];
  let answered = 0;
  for (const ask of pending) {
    try {
      const earlier = earlierFor(ask, options.store.list());
      const context = { ...(ask.realm ? { realm: ask.realm } : {}), ...(earlier ? { earlier } : {}), ...(ask.player ? { player: ask.player } : {}) };
      const { answer, source } = await options.engine.answer(ask.question, Object.keys(context).length ? context : undefined);
      // A follow-up is kept with the question it leaned on, so the next follow-up still carries the first one's names;
      // "here" is kept as the zone it meant, in this local store. The class and level are not kept.
      const asked = withPlayer(ask.question, ask.player);
      const kept = earlier ? lookupText(asked, { earlier }) : asked;
      options.store.add({ id: ask.id, answer: answer.slice(0, MAX_ANSWER), source, answeredAt: now().toISOString(), question: kept, askedAt: ask.askedAt });
      answered++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ id: ask.id, answer: `Could not answer yet (${message}). It is tried again while the companion runs.`.slice(0, MAX_ANSWER), source: "none", answeredAt: now().toISOString(), retry: true });
    }
  }
  writeAnswersAddon(options.addonsDir, [...options.store.list(), ...failures]);
  return { answered, failed: failures.length };
}
