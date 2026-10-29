/**
 * The answer key: for the bank's questions whose answer the game-data files hold, the facts a correct answer has
 * to carry, read from the files of the build they came from. Nothing is written by hand and nothing is stored
 * apart from the bank: a new build regenerates the key, and `diffAnswerKeys` lists the questions whose answer it
 * changed (docs/design/specs/2026-10-27-question-bank-design.md, "The answer key").
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Question, Subject } from "./question-bank.js";

/** The facts a correct answer carries, which file and field they come from, and the game build that file was read from. */
export interface Answer { facts: string[]; from: string; build: string | null }

export type AnswerKey = (template: string, subject: Subject) => Answer | undefined;

const readJson = (path: string): unknown => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined);
const asRecord = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const versionOf = (file: unknown): string | null => {
  const r = asRecord(file);
  return text(asRecord(r?.build)?.version) ?? text(asRecord(r?.source)?.version) ?? null;
};
const unique = (list: (string | undefined)[]): string[] => [...new Set(list.filter((s): s is string => !!s))];

/** The key for one game-data folder. A missing file or field gives no answer for its questions, never a guess. */
export function gameDataAnswerKey(gameDataDir: string): AnswerKey {
  const map = asRecord(readJson(join(gameDataDir, "map.json")));
  const mapBuild = versionOf(map);
  const zoneName = new Map(asArray(map?.zones).map((z) => [asRecord(z)?.uiMapId, text(asRecord(z)?.name)]));
  const entrances = new Map(asArray(map?.entrances).map((e) => [asRecord(e)?.mapId, asRecord(e)!]));
  const flights = new Map(asArray(map?.flightNodes).map((f) => [asRecord(f)?.id, asRecord(f)!]));
  // A flight node's own name ends in its zone ("Lakeshire, Redridge"); the map's zone list wins when it has the node's map.
  const flightZone = (f: Record<string, unknown>) => zoneName.get(f.uiMapId) ?? text(String(f.name ?? "").split(",").slice(1).join(","));

  const encountersFile = readJson(join(gameDataDir, "client-encounters.json"));
  const encounters = asRecord(asRecord(encountersFile)?.instances) ?? {};
  const mountsFile = readJson(join(gameDataDir, "client-mounts.json"));
  const mounts = asRecord(asRecord(mountsFile)?.mounts) ?? {};

  // A talent name can sit in more than one class's tree; every class that has it is part of the answer.
  const talentClasses = new Map<string, string[]>();
  let talentBuild: string | null = null;
  const talentsDir = join(gameDataDir, "talents");
  if (existsSync(talentsDir)) {
    for (const file of readdirSync(talentsDir).filter((f) => f.endsWith(".json")).sort()) {
      const cls = asRecord(readJson(join(talentsDir, file)));
      const className = text(cls?.className);
      talentBuild ??= versionOf(cls);
      if (!className) continue;
      for (const tree of asArray(cls?.trees)) for (const node of asArray(asRecord(tree)?.nodes)) for (const entry of asArray(asRecord(node)?.entries)) {
        const name = text(asRecord(entry)?.name)?.toLowerCase();
        if (name) talentClasses.set(name, unique([...(talentClasses.get(name) ?? []), className]));
      }
    }
  }

  const answer = (facts: (string | undefined)[], from: string, build: string | null): Answer | undefined => {
    const list = unique(facts);
    return list.length ? { facts: list, from, build } : undefined;
  };
  const bossMap = (s: Subject) => (typeof s.id === "string" ? Number(s.id.split(":")[0]) : undefined);

  return (template, s) => {
    switch (`${template}:${s.kind}`) {
      case "riding-skill:mount": {
        const skill = asRecord(mounts[String(s.id)])?.ridingSkill;
        return typeof skill === "number" ? answer([String(skill)], "client-mounts.json mounts.ridingSkill", versionOf(mountsFile)) : undefined;
      }
      case "level:instance": {
        const e = entrances.get(s.id);
        return answer([e?.minLevel, e?.maxLevel].map((n) => (typeof n === "number" ? String(n) : undefined)), "map.json entrances.minLevel/maxLevel", mapBuild);
      }
      case "where-is:instance":
        return answer([zoneName.get(entrances.get(s.id)?.uiMapId)], "map.json entrances.uiMapId -> zones.name", mapBuild);
      case "bosses:instance":
        return answer(asArray(encounters[String(s.id)]).map((b) => text(asRecord(b)?.name)), "client-encounters.json instances[mapId].name", versionOf(encountersFile));
      case "where-is:boss":
        return answer([text(entrances.get(bossMap(s))?.name)], "client-encounters.json mapId -> map.json entrances.name", versionOf(encountersFile));
      case "where-is:flight":
      case "flight-to:flight": {
        const f = flights.get(s.id);
        return f ? answer([flightZone(f)], "map.json flightNodes -> zone", mapBuild) : undefined;
      }
      case "talent-class:talent":
        return answer(talentClasses.get(s.name.toLowerCase()) ?? [], "talents/*.json className", talentBuild);
      // No criteria: their text stays on the achievement's page (docs/DATA_POLICY.md), so no tool answer carries it.
      default:
        return undefined;
    }
  };
}

export interface AnswerChange { id: string; text: string; before: string[]; after: string[] }

export interface AnswerDiff {
  builds: { before: string[]; after: string[] };
  /** The same question, a different answer: these are what a game update changed and what to check first. */
  changed: AnswerChange[];
  /** Questions that have an answer now and had none before (a new subject, or a file that gained the field). */
  added: AnswerChange[];
  /** Questions that had an answer and have none now (the subject left the files, or the field did). */
  removed: AnswerChange[];
}

const sameFacts = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((f, i) => f === [...b].sort()[i]);
const buildsOf = (bank: readonly Question[]) => unique(bank.map((q) => q.answer?.build ?? undefined)).sort();

/** Two banks' answers compared by question id. Order inside a list of facts does not count as a change. */
export function diffAnswerKeys(before: readonly Question[], after: readonly Question[]): AnswerDiff {
  const old = new Map(before.filter((q) => q.answer).map((q) => [q.id, q]));
  const now = new Map(after.filter((q) => q.answer).map((q) => [q.id, q]));
  const diff: AnswerDiff = { builds: { before: buildsOf(before), after: buildsOf(after) }, changed: [], added: [], removed: [] };
  for (const [id, q] of now) {
    const was = old.get(id);
    if (!was) diff.added.push({ id, text: q.text, before: [], after: q.answer!.facts });
    else if (!sameFacts(was.answer!.facts, q.answer!.facts)) diff.changed.push({ id, text: q.text, before: was.answer!.facts, after: q.answer!.facts });
  }
  for (const [id, q] of old) if (!now.has(id)) diff.removed.push({ id, text: q.text, before: q.answer!.facts, after: [] });
  return diff;
}

/** Text in a markdown table cell: a backslash first, then the pipe that would end the cell. */
const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
const facts = (list: string[]) => (list.length ? list.map(cell).join(", ") : "–");

export function formatAnswerDiff(diff: AnswerDiff): string {
  const lines = [
    "# Answer changes between builds",
    "",
    `Before: ${diff.builds.before.join(", ") || "unknown build"}. After: ${diff.builds.after.join(", ") || "unknown build"}.`,
    `${diff.changed.length} changed, ${diff.added.length} added, ${diff.removed.length} removed.`,
  ];
  for (const [title, rows] of [["Changed", diff.changed], ["Added", diff.added], ["Removed", diff.removed]] as const) {
    lines.push("", `## ${title} (${rows.length})`, "");
    if (!rows.length) { lines.push("None."); continue; }
    lines.push("| question | before | after |", "|---|---|---|");
    for (const r of rows) lines.push(`| ${cell(r.text)} | ${facts(r.before)} | ${facts(r.after)} |`);
  }
  return `${lines.join("\n")}\n`;
}
