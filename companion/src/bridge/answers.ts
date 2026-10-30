import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adler32, luaString } from "./lua";

/**
 * `question` and `askedAt` stay in the companion's own store, on the player's computer, so a follow-up can lean on
 * the question before it; the slot addon is written without them.
 */
export interface Answer {
  id: string; answer: string; source: string; answeredAt: string; question?: string; askedAt?: string;
  /** A failure the companion tries again: the addon shows it once and keeps the question waiting for the real answer. */
  retry?: boolean;
}

export const ANSWERS_ADDON = "EverlootAnswers";
// Same interface number as addon/Everloot.toc, so the client loads both without "out of date".
export const INTERFACE = "16001";

/** The slot addon the client loads on /reload: a TOC and one data file the main addon reads. */
export function renderAnswersAddon(answers: Answer[]): { toc: string; lua: string } {
  const toc = [
    `## Interface: ${INTERFACE}`,
    "## Title: Everloot Answers",
    "## Notes: Written by the Everloot companion. Answers to /ask, shown after /reload.",
    "## Author: Everloot",
    "",
    `${ANSWERS_ADDON}.lua`,
    "",
  ].join("\n");
  const rows = answers.map((a) =>
    `  [${luaString(a.id)}] = { ["answer"] = ${luaString(a.answer)}, ["source"] = ${luaString(a.source)}, ` +
    `["answeredAt"] = ${luaString(a.answeredAt)}, ["sum"] = ${adler32(a.answer)}${a.retry ? `, ["retry"] = true` : ""} },`);
  const lua = [
    "-- Written by the Everloot companion. Do not edit: the next answer replaces this file.",
    "EverlootAnswersDB = {",
    ...rows,
    "}",
    "",
  ].join("\n");
  return { toc, lua };
}

export function writeAnswersAddon(addonsDir: string, answers: Answer[]): void {
  const dir = join(addonsDir, ANSWERS_ADDON);
  mkdirSync(dir, { recursive: true });
  const { toc, lua } = renderAnswersAddon(answers);
  for (const [name, body] of [[`${ANSWERS_ADDON}.toc`, toc], [`${ANSWERS_ADDON}.lua`, lua]] as const) {
    writeFileSync(join(dir, `${name}.tmp`), body);
    renameSync(join(dir, `${name}.tmp`), join(dir, name));
  }
}
