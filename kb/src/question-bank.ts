/**
 * The question bank: the questions players are likely to ask Everloot, in the shapes they ask them, each with
 * the subject it is about and what a good answer needs. It is generated from Everloot's own data (the
 * committed game-data files and the knowledge release's page titles) plus a hand-written long tail, so it
 * costs nothing to regenerate and never copies anyone's forum. The eval (`question-eval.ts`) runs the bank
 * through the same lookups the MCP tools and the chat use and reports what resolves and what does not
 * (docs/design/specs/2026-10-27-question-bank-design.md).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnswerKey, Answer } from "./answer-key.js";
import type { DB } from "./db.js";

/** What a question is about. The knowledge kinds the release holds, plus the kinds only the game-data files name. */
export type SubjectKind =
  | "zone" | "instance" | "boss" | "flight" | "mount" | "achievement" | "profession" | "talent" | "item_category"
  | "wiki_instance" | "wiki_npc" | "wiki_item" | "wiki_quest" | "wiki_zone"
  | "alias" | "topic";

export interface Subject { kind: SubjectKind; name: string; /** The id in its own file, when it has one. */ id?: number | string }

export interface Question {
  /** Stable across runs: `<template>:<kind>:<slug of the name>`. */
  id: string;
  text: string;
  template: string;
  subject: Subject;
  /** What a good answer needs: the subject's name to resolve to a record, evidence to come back, or both. */
  expects: { resolve: boolean; evidence: boolean };
  /** The facts a correct answer carries, when the game-data files hold them (`answer-key.ts`). */
  answer?: Answer;
}

interface Template { id: string; kinds: readonly SubjectKind[]; ask: (name: string) => string; expects?: Partial<Question["expects"]> }

/** The shapes, per subject kind. Short, the way a player types, with the name as they would say it. */
export const TEMPLATES: readonly Template[] = [
  { id: "where-is", kinds: ["zone", "instance", "boss", "flight", "wiki_instance", "wiki_npc", "wiki_zone"], ask: (n) => `where is ${n}` },
  { id: "entrance", kinds: ["instance", "wiki_instance"], ask: (n) => `where is the ${n} entrance` },
  { id: "level", kinds: ["instance", "zone", "wiki_instance", "wiki_zone"], ask: (n) => `what level is ${n}` },
  { id: "bosses", kinds: ["instance", "wiki_instance"], ask: (n) => `which bosses are in ${n}` },
  { id: "drops", kinds: ["boss", "wiki_npc"], ask: (n) => `what does ${n} drop` },
  { id: "drops-from", kinds: ["wiki_item"], ask: (n) => `where does ${n} drop` },
  { id: "sells", kinds: ["wiki_item"], ask: (n) => `who sells ${n}` },
  { id: "worth", kinds: ["wiki_item"], ask: (n) => `what is ${n} worth` },
  { id: "what-is", kinds: ["wiki_item", "mount", "achievement", "talent"], ask: (n) => `what is ${n}` },
  { id: "how-get", kinds: ["mount", "achievement", "wiki_item"], ask: (n) => `how do I get ${n}` },
  { id: "riding-skill", kinds: ["mount"], ask: (n) => `what riding skill does ${n} need` },
  { id: "criteria", kinds: ["achievement"], ask: (n) => `what do I need for the ${n} achievement` },
  { id: "quest-giver", kinds: ["wiki_quest"], ask: (n) => `who gives the quest ${n}` },
  { id: "quest-how", kinds: ["wiki_quest"], ask: (n) => `how do I complete ${n}` },
  { id: "quest-reward", kinds: ["wiki_quest"], ask: (n) => `what does ${n} reward` },
  { id: "profession-level", kinds: ["profession"], ask: (n) => `how do I level ${n}` },
  { id: "profession-makes", kinds: ["profession"], ask: (n) => `what can ${n} make` },
  { id: "talent-class", kinds: ["talent"], ask: (n) => `which class has ${n}` },
  { id: "category-best", kinds: ["item_category"], ask: (n) => `what are the best ${n}` },
  { id: "flight-to", kinds: ["flight"], ask: (n) => `how do I fly to ${n}` },
  { id: "alias", kinds: ["alias"], ask: (n) => n },
  { id: "topic", kinds: ["topic"], ask: (n) => n, expects: { resolve: false, evidence: true } },
];

/**
 * How players shorten instance names. Each alias expects to resolve to the instance named beside it, by the
 * title the knowledge release carries (`name-aliases.ts` maps the short forms).
 */
export const INSTANCE_ALIASES: readonly { alias: string; name: string }[] = [
  { alias: "where is MC", name: "Molten Core" },
  { alias: "BRD entrance", name: "Blackrock Depths" },
  { alias: "how do I get to BWL", name: "Blackwing Lair" },
  { alias: "ZG bosses", name: "Zul'Gurub" },
  { alias: "AQ40 attunement", name: "Temple of Ahn'Qiraj" },
  { alias: "AQ20 entrance", name: "Ruins of Ahn'Qiraj" },
  { alias: "where is SM", name: "Scarlet Monastery" },
  { alias: "DM east", name: "Dire Maul" },
  { alias: "VC level", name: "Deadmines" },
  { alias: "WC entrance", name: "Wailing Caverns" },
  { alias: "RFC level", name: "Ragefire Chasm" },
  { alias: "SFK bosses", name: "Shadowfang Keep" },
  { alias: "ST entrance", name: "Temple of Atal'Hakkar" },
  { alias: "UBRS key", name: "Blackrock Spire" },
  { alias: "Strat live", name: "Stratholme" },
  { alias: "Scholo bosses", name: "Scholomance" },
  { alias: "Mara entrance", name: "Maraudon" },
  { alias: "Ony attunement", name: "Onyxia's Lair" },
  { alias: "Naxx bosses", name: "Naxxramas" },
  { alias: "Uld entrance", name: "Uldaman" },
];

/** The long tail: questions about the game and the ecosystem that no single record answers. Evidence is what they need. */
export const TOPICS: readonly { text: string; topic: string }[] = [
  { text: "what is WoW Forever", topic: "forever" },
  { text: "when does Forever launch", topic: "forever" },
  { text: "is Forever the same as Classic", topic: "forever" },
  { text: "what changed in the last patch", topic: "changes" },
  { text: "what is the best class for a new player", topic: "class" },
  { text: "what is the best healer", topic: "class" },
  { text: "which class is best for farming gold", topic: "gold" },
  { text: "how do I make gold at level 60", topic: "gold" },
  { text: "what is a good leveling route for Horde", topic: "leveling" },
  { text: "what is a good leveling route for Alliance", topic: "leveling" },
  { text: "fastest way to level 1 to 60", topic: "leveling" },
  { text: "what professions should a mage take", topic: "profession" },
  { text: "what professions make the most gold", topic: "profession" },
  { text: "where do I learn riding", topic: "mount" },
  { text: "how much does a mount cost", topic: "mount" },
  { text: "how do I get to Stranglethorn Vale", topic: "travel" },
  { text: "how do I get from Orgrimmar to Thunder Bluff", topic: "travel" },
  { text: "where is the auction house in Orgrimmar", topic: "travel" },
  { text: "what addons should I use", topic: "addons" },
  { text: "is Polestar still maintained", topic: "ecosystem" },
  { text: "what is Everloot", topic: "everloot" },
  { text: "how does the Everloot addon work", topic: "everloot" },
  { text: "does Everloot read my character data", topic: "everloot" },
  { text: "how many players are on the realm", topic: "population" },
  { text: "which faction has more players", topic: "population" },
  { text: "what is the price of Arcanite Bar", topic: "market" },
  { text: "how much is Black Lotus", topic: "market" },
  { text: "what is the raid buff from a priest", topic: "raid" },
  { text: "what buffs does a paladin bring to a raid", topic: "raid" },
  { text: "which talents should a fire mage take", topic: "talents" },
  { text: "best warrior tank build", topic: "talents" },
  { text: "how do I unlock the Blackrock Depths bar", topic: "instance" },
  { text: "do I need a key for Scholomance", topic: "instance" },
  { text: "what reputation do I need for Thorium Brotherhood", topic: "reputation" },
  { text: "how do I get exalted with Timbermaw", topic: "reputation" },
  { text: "what is the Darkmoon Faire", topic: "event" },
  { text: "when is the next holiday", topic: "event" },
  { text: "who is Thrall", topic: "lore" },
  { text: "what happened to Onyxia", topic: "lore" },
  { text: "why is Stratholme in ruins", topic: "lore" },
];

/** The committed game-data files this reads; each is optional, so the bank grows as files land. */
export interface GameDataSubjects { root: string }

const readJson = (path: string): unknown => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined);
const asRecord = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const nameOf = (v: unknown): string | undefined => { const r = asRecord(v); return r && typeof r.name === "string" && r.name.trim() ? r.name.trim() : undefined; };

/** Every subject the game-data files name, in file order, duplicates removed per kind. */
export function gameDataSubjects(gameDataDir: string): Subject[] {
  const out: Subject[] = [];
  const seen = new Set<string>();
  const push = (s: Subject) => { const key = `${s.kind}|${s.name.toLowerCase()}`; if (!seen.has(key)) { seen.add(key); out.push(s); } };
  const map = asRecord(readJson(join(gameDataDir, "map.json")));
  for (const z of asArray(map?.zones)) { const name = nameOf(z); if (name) push({ kind: "zone", name, id: asRecord(z)?.uiMapId as number }); }
  for (const e of asArray(map?.entrances)) { const name = nameOf(e); if (name) push({ kind: "instance", name, id: asRecord(e)?.mapId as number }); }
  for (const f of asArray(map?.flightNodes)) { const name = nameOf(f); if (name) push({ kind: "flight", name: name.split(",")[0]!.trim(), id: asRecord(f)?.id as number }); }
  const encounters = asRecord(asRecord(readJson(join(gameDataDir, "client-encounters.json")))?.instances);
  for (const [mapId, list] of Object.entries(encounters ?? {})) for (const b of asArray(list)) { const name = nameOf(b); if (name) push({ kind: "boss", name, id: `${mapId}:${asRecord(b)?.id}` }); }
  const mounts = asRecord(asRecord(readJson(join(gameDataDir, "client-mounts.json")))?.mounts);
  for (const [id, m] of Object.entries(mounts ?? {})) { const name = nameOf(m); if (name) push({ kind: "mount", name, id }); }
  const achievements = asRecord(asRecord(readJson(join(gameDataDir, "client-achievements.json")))?.achievements);
  for (const [id, a] of Object.entries(achievements ?? {})) { const r = asRecord(a); const title = r && typeof r.title === "string" ? r.title.trim() : ""; if (title) push({ kind: "achievement", name: title, id }); }
  const layer = asRecord(asRecord(readJson(join(gameDataDir, "client-layer.json")))?.categories);
  for (const s of asArray(layer?.skills)) { const name = nameOf(s); if (name) push({ kind: "profession", name, id: asRecord(s)?.id as number }); }
  for (const c of asArray(layer?.classes)) { const r = asRecord(c); const label = r && typeof r.label === "string" ? r.label : nameOf(c); if (label) push({ kind: "item_category", name: label, id: r?.id as number }); }
  const talentsDir = join(gameDataDir, "talents");
  if (existsSync(talentsDir)) {
    for (const file of readdirSorted(talentsDir)) {
      const cls = asRecord(readJson(join(talentsDir, file)));
      for (const tree of asArray(cls?.trees)) for (const node of asArray(asRecord(tree)?.nodes)) for (const entry of asArray(asRecord(node)?.entries)) {
        const name = nameOf(entry); if (name) push({ kind: "talent", name, id: asRecord(entry)?.spellId as number });
      }
    }
  }
  return out;
}

const readdirSorted = (dir: string): string[] => readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

/** Wiki page categories that mark a page as one kind of thing; the first rule that matches wins. */
const WIKI_RULES: readonly { kind: SubjectKind; category: RegExp }[] = [
  { kind: "wiki_instance", category: /^Instances$/ },
  { kind: "wiki_quest", category: /^(Classic|Vanilla) quests$|^.* quests$/ },
  { kind: "wiki_npc", category: /^Named mobs$|^.* mobs$|^.* characters$/ },
  { kind: "wiki_item", category: /^.* items$/ },
  { kind: "wiki_zone", category: /^Zones$|^.* zones$|^Human territories$|^Orc territories$/ },
];

/**
 * Page titles from the knowledge release, by what their wiki categories say they are, `perKind` of each,
 * spread across the alphabet (every k-th title in name order) so the sample is the same on every run.
 */
export function wikiSubjects(db: DB, perKind: number): Subject[] {
  const out: Subject[] = [];
  const rows = db.prepare("SELECT id, name, data FROM entities WHERE kind = 'lore_page' AND game_version = 'lore' ORDER BY name").all() as { id: number; name: string; data: string }[];
  const byKind = new Map<SubjectKind, { id: number; name: string }[]>();
  for (const row of rows) {
    let categories: unknown;
    try { categories = (JSON.parse(row.data) as { categories?: unknown }).categories; } catch { continue; }
    const cats = asArray(categories).filter((c): c is string => typeof c === "string");
    const rule = WIKI_RULES.find((r) => cats.some((c) => r.category.test(c)));
    if (!rule || /[()\/]/.test(row.name)) continue;
    const list = byKind.get(rule.kind) ?? [];
    list.push({ id: row.id, name: row.name });
    byKind.set(rule.kind, list);
  }
  for (const rule of WIKI_RULES) {
    const list = byKind.get(rule.kind) ?? [];
    const step = Math.max(1, Math.floor(list.length / perKind));
    for (let i = 0; i < list.length && out.filter((s) => s.kind === rule.kind).length < perKind; i += step) out.push({ kind: rule.kind, name: list[i]!.name, id: list[i]!.id });
  }
  return out;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The bank: every template applied to every subject of its kinds, then the aliases and the long tail. */
export function buildQuestionBank(subjects: readonly Subject[], key?: AnswerKey): Question[] {
  const out: Question[] = [];
  const seen = new Set<string>();
  const add = (q: Question) => { if (!seen.has(q.id)) { seen.add(q.id); out.push(q); } };
  for (const t of TEMPLATES) {
    if (t.kinds.includes("alias") || t.kinds.includes("topic")) continue;
    for (const s of subjects) {
      if (!t.kinds.includes(s.kind)) continue;
      const answer = key?.(t.id, s);
      add({ id: `${t.id}:${s.kind}:${slug(s.name)}`, text: t.ask(s.name), template: t.id, subject: s, expects: { resolve: true, evidence: true, ...t.expects }, ...(answer ? { answer } : {}) });
    }
  }
  for (const a of INSTANCE_ALIASES) add({ id: `alias:alias:${slug(a.alias)}`, text: a.alias, template: "alias", subject: { kind: "alias", name: a.name }, expects: { resolve: true, evidence: true } });
  for (const t of TOPICS) add({ id: `topic:topic:${slug(t.text)}`, text: t.text, template: "topic", subject: { kind: "topic", name: t.topic }, expects: { resolve: false, evidence: true } });
  return out;
}

/** One question per line, for diffs and for the eval. */
export const serializeQuestionBank = (bank: readonly Question[]): string => bank.map((q) => JSON.stringify(q)).join("\n") + "\n";

export function parseQuestionBank(text: string): Question[] {
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Question);
}
