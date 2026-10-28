import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readAsks } from "./asks";
import { writeAnswersAddon, type Answer } from "./answers";
import { MAX_ANSWER, type AnswerEngine } from "./engine";
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

/** Answer every new /ask in one SavedVariables file and rewrite the slot addon. Failures are shown, and retried next time. */
export async function answerPending(options: {
  svFile: string; addonsDir: string; engine: AnswerEngine; store: AnswerStore; now?: () => Date;
}): Promise<{ answered: number; failed: number }> {
  const now = options.now ?? (() => new Date());
  const asks = readAsks(readFileSync(options.svFile, "utf8"));
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
      const { answer, source } = await options.engine.answer(ask.question, ask.realm ? { realm: ask.realm } : undefined);
      options.store.add({ id: ask.id, answer: answer.slice(0, MAX_ANSWER), source, answeredAt: now().toISOString() });
      answered++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ id: ask.id, answer: `Could not answer: ${message}`.slice(0, MAX_ANSWER), source: "none", answeredAt: now().toISOString() });
    }
  }
  writeAnswersAddon(options.addonsDir, [...options.store.list(), ...failures]);
  return { answered, failed: failures.length };
}
