/**
 * Completion progress for one character: achievements, reputation, titles and quest chains.
 * A catalog entry is listed after 3 players (upload addresses) report the identical entry. Owned is what one install's
 * character uploaded, shown only when that install's current grant covers the collection category.
 * Missing is the agreed list minus what that character has. No Blizzard profile, no copied catalog.
 * The facts come from the completion rollup (kb/src/completion-rollup.ts).
 */
import { COMPLETION_AGREEMENT } from "./completion-rollup.js";
import { slugify } from "./lore-slug.js";

export { COMPLETION_AGREEMENT };
export const CLOSEST_LIMIT = 5;

/** `criteria` is present only when three reporters sent the identical complete list. */
export type AchievementEntry = { achievementId: number; name: string; category: string; points: number; criteriaCount: number; criteria?: { text: string; required: number }[] };
export type FactionEntry = { factionId: number; name: string; header?: string; major: boolean };
export type TitleEntry = { titleId: number; name: string };
export type ChainEntry = { questLineId: number; name: string; questIds: number[]; truncated: boolean };

export type OwnedCharacter = {
  installId: string;
  characterKey: string;
  class: string;
  level: number;
  /** `earnedOn` is the date the upload carried for a completed achievement, when it carried one. */
  achievements: Map<number, { completed: boolean; earnedByMe?: boolean; criteriaMet: number; criteriaTotal: number; quantity?: number; required?: number; earnedOn?: string }>;
  factions: Map<number, { reaction: number; standing: number; floor: number; ceiling: number }>;
  titles: Set<number>;
  quests: Set<number>;
};

export type CompletionFacts = {
  achievements: Map<number, AchievementEntry>;
  factions: Map<number, FactionEntry>;
  titles: Map<number, TitleEntry>;
  chains: Map<number, ChainEntry>;
  owned: OwnedCharacter[];
  /** Per install, characters the rollup no longer holds (it keeps 8 per install, the oldest give way). */
  dropped?: Map<string, number>;
};

const EMPTY_FACTS: CompletionFacts = { achievements: new Map(), factions: new Map(), titles: new Map(), chains: new Map(), owned: [] };

/** The usual eight standings, by the client's reaction index. Index 8 is the top one. */
export const STANDING_NAMES = ["Hated", "Hostile", "Unfriendly", "Neutral", "Friendly", "Honored", "Revered", "Exalted"] as const;
const TOP_REACTION = STANDING_NAMES.length;

export type ClosestAchievement = { achievementId: number; name: string; category: string; have: number; of: number; unit: "criteria" | "progress" };
export type ClosestFaction = { factionId: number; name: string; standing: string; toNext: number; header?: string };
/** A reputation whose scale is not the eight standings (a friendship or renown style row): the raw value only. */
export type UnscaledFaction = { factionId: number; name: string; standing: number };
export type ClosestChain = { questLineId: number; name: string; done: number; total: number; truncated: boolean };

export type CharacterProgress = {
  characterKey: string;
  class: string;
  level: number;
  achievements: { done: number; total: number; points: number; pointsTotal: number; closest: ClosestAchievement[]; unlisted: number };
  reputation: { exalted: number; total: number; closest: ClosestFaction[]; unscaled: UnscaledFaction[]; unlisted: number };
  titles: { known: number; total: number; unlisted: number };
  quests: { completed: number; chainsDone: number; chainsTotal: number; closest: ClosestChain[] };
};

export type CompletionProgress = {
  ownerInstallId: string;
  /** What the agreed lists hold. All zero means no list is public yet. */
  listed: { achievements: number; factions: number; titles: number; chains: number };
  /** False when this install has no shared completion data: owned is unknown, not empty. */
  ownedRecorded: boolean;
  characters: CharacterProgress[];
  /** The character key that was asked for and not found. */
  unknownCharacter?: string;
  /** Characters of this install the site no longer holds: older ones give way past 8, or when storage is trimmed. */
  droppedCharacters: number;
};

export function completionProgress(ownerInstallId: string, characterKey: string | undefined, facts: CompletionFacts): CompletionProgress {
  const owner = ownerInstallId.trim();
  const wantedKey = characterKey?.trim().toLowerCase() || undefined;
  const { achievements, factions, titles, chains } = facts;
  const mine = facts.owned.filter((c) => c.installId.trim() === owner).sort((a, b) => a.characterKey.localeCompare(b.characterKey));
  const characters: CharacterProgress[] = [];

  for (const c of mine) {
    if (wantedKey && c.characterKey !== wantedKey) continue;
    let done = 0;
    let earnedPoints = 0;
    let unlistedAchievements = 0;
    const closestAchievements: ClosestAchievement[] = [];
    for (const [id, a] of c.achievements) {
      const entry = achievements.get(id);
      // Complete on the account but earned by another character counts as not done here, as the game's window shows it.
      const mineDone = a.completed && a.earnedByMe !== false;
      if (!entry) { if (mineDone) unlistedAchievements++; continue; }
      if (mineDone) { done++; earnedPoints += entry.points; continue; }
      if (a.completed) continue;
      if (a.required && a.quantity !== undefined && a.quantity < a.required) {
        closestAchievements.push({ achievementId: id, name: entry.name, category: entry.category, have: a.quantity, of: a.required, unit: "progress" });
      } else if (a.criteriaTotal > 0 && a.criteriaMet > 0 && a.criteriaMet < a.criteriaTotal) {
        // Every criterion met but not complete is left out: nothing is left to do, and the game decides when it completes.
        closestAchievements.push({ achievementId: id, name: entry.name, category: entry.category, have: a.criteriaMet, of: a.criteriaTotal, unit: "criteria" });
      }
    }
    closestAchievements.sort((x, y) => y.have / y.of - x.have / x.of || (x.of - x.have) - (y.of - y.have) || x.achievementId - y.achievementId);

    const plainFactions = [...factions.values()].filter((f) => !f.major);
    const closestFactions: ClosestFaction[] = [];
    const unscaled: UnscaledFaction[] = [];
    let exalted = 0;
    let unlistedFactions = 0;
    for (const [id, f] of c.factions) {
      const entry = factions.get(id);
      const scaled = f.reaction >= 1 && f.reaction <= TOP_REACTION;
      if (!entry) { if (scaled && f.reaction === TOP_REACTION) unlistedFactions++; continue; }
      if (entry.major) continue;
      if (!scaled) { unscaled.push({ factionId: id, name: entry.name, standing: f.standing }); continue; }
      if (f.reaction === TOP_REACTION) { exalted++; continue; }
      if (f.ceiling > f.standing) {
        closestFactions.push({ factionId: id, name: entry.name, header: entry.header, standing: STANDING_NAMES[f.reaction - 1], toNext: f.ceiling - f.standing });
      }
    }
    closestFactions.sort((x, y) => x.toNext - y.toNext || x.factionId - y.factionId);
    unscaled.sort((x, y) => x.factionId - y.factionId);

    const knownTitles = [...c.titles].filter((id) => titles.has(id)).length;

    const closestChains: ClosestChain[] = [];
    let chainsDone = 0;
    for (const chain of chains.values()) {
      const have = chain.questIds.filter((id) => c.quests.has(id)).length;
      // A chain cut at 80 quests is never called finished: its real length is not known.
      if (!chain.truncated && have === chain.questIds.length) chainsDone++;
      else if (have > 0) closestChains.push({ questLineId: chain.questLineId, name: chain.name, done: have, total: chain.questIds.length, truncated: chain.truncated });
    }
    closestChains.sort((x, y) => Number(x.truncated) - Number(y.truncated) || (x.total - x.done) - (y.total - y.done) || y.total - x.total || x.questLineId - y.questLineId);

    characters.push({
      characterKey: c.characterKey, class: c.class, level: c.level,
      achievements: {
        done, total: achievements.size, points: earnedPoints, pointsTotal: [...achievements.values()].reduce((sum, a) => sum + a.points, 0),
        closest: closestAchievements.slice(0, CLOSEST_LIMIT), unlisted: unlistedAchievements,
      },
      reputation: { exalted, total: plainFactions.length, closest: closestFactions.slice(0, CLOSEST_LIMIT), unscaled: unscaled.slice(0, CLOSEST_LIMIT), unlisted: unlistedFactions },
      titles: { known: knownTitles, total: titles.size, unlisted: c.titles.size - knownTitles },
      quests: { completed: c.quests.size, chainsDone, chainsTotal: chains.size, closest: closestChains.slice(0, CLOSEST_LIMIT) },
    });
  }

  return {
    ownerInstallId: owner,
    listed: { achievements: achievements.size, factions: factions.size, titles: titles.size, chains: chains.size },
    ownedRecorded: mine.length > 0,
    characters,
    unknownCharacter: wantedKey && mine.length > 0 && characters.length === 0 ? wantedKey : undefined,
    droppedCharacters: facts.dropped?.get(owner) ?? 0,
  };
}

const listedNothing = (l: CompletionProgress["listed"]) => l.achievements + l.factions + l.titles + l.chains === 0;

/** Why there is nothing to show, or null when there is something. Shared by the page and the MCP tool. */
export function completionEmptyState(p: CompletionProgress): string | null {
  if (!p.ownedRecorded) {
    return "No completion data from this install. The addon's completion module is off until you run /everloot completion on, "
      + "and its progress is shown here only when the install's upload shared \"My collection ownership and completion progress\" with a verified grant. "
      + "This is unrecorded, not zero.";
  }
  if (p.unknownCharacter) return `No character ${p.unknownCharacter} in this install's completion upload.`;
  return null;
}

/** Said when the site dropped older characters of this install, so a missing one is not read as never uploaded. */
export function droppedCharactersNote(p: CompletionProgress): string | null {
  if (p.droppedCharacters <= 0) return null;
  return `${p.droppedCharacters} older character${p.droppedCharacters === 1 ? " is" : "s are"} no longer kept for this install. The site keeps the 8 most recently uploaded; upload from a character to bring it back.`;
}

export const ANOTHER_CHARACTER_NOTE = "An achievement earned on another character of the account counts as not done here: the game's window shows it the same way.";

export function formatCompletionProgress(p: CompletionProgress): string {
  const lines = [
    `Completion progress for install ${p.ownerInstallId}`,
    `A list entry is public after ${COMPLETION_AGREEMENT} players (installs uploading from different addresses) report it identically. Owned is what one character uploaded. Closest to done means the largest share of an achievement's criteria or progress bar, the next standing nearest, or the fewest quests left in a chain. ${ANOTHER_CHARACTER_NOTE}`,
  ];
  const dropped = droppedCharactersNote(p);
  if (dropped) lines.push(dropped);
  const empty = completionEmptyState(p);
  if (empty) return [...lines, empty].join("\n");
  if (listedNothing(p.listed)) {
    lines.push(`Lists unrecorded: ${COMPLETION_AGREEMENT} players have not yet reported the same achievements, factions, titles or quest chains, so totals below read 0.`);
  }
  for (const c of p.characters) {
    lines.push("", `Character ${c.characterKey} (${c.class} ${c.level})`);
    lines.push(`Achievements: ${c.achievements.done} of ${c.achievements.total} done, ${c.achievements.points} of ${c.achievements.pointsTotal} points`);
    for (const a of c.achievements.closest) lines.push(`  ${a.name} (${a.category}): ${a.have} of ${a.of} ${a.unit === "progress" ? "progress" : "criteria"}`);
    lines.push(`Reputation: ${c.reputation.exalted} of ${c.reputation.total} factions Exalted`);
    for (const f of c.reputation.closest) lines.push(`  ${f.name}: ${f.standing}, ${f.toNext} to the next standing`);
    for (const f of c.reputation.unscaled) lines.push(`  ${f.name}: standing value ${f.standing}, scale unknown (not one of the eight standings)`);
    lines.push(`Titles: ${c.titles.known} of ${c.titles.total} known`);
    lines.push(`Quests: ${c.quests.completed} completed, ${c.quests.chainsDone} of ${c.quests.chainsTotal} listed chains finished`);
    for (const q of c.quests.closest) lines.push(`  ${q.name}: ${q.done} of ${q.truncated ? `at least ${q.total}` : q.total} quests`);
    const extra = c.achievements.unlisted + c.reputation.unlisted + c.titles.unlisted;
    if (extra > 0) lines.push(`Reported by this character and not yet on the agreed lists: ${extra}`);
  }
  return lines.join("\n");
}

export function handleCompletionProgress(
  args: { ownerInstallId: string; characterKey?: string },
  facts: CompletionFacts = EMPTY_FACTS,
): string {
  if (!args.ownerInstallId.trim()) return "Name the install.";
  return formatCompletionProgress(completionProgress(args.ownerInstallId, args.characterKey, facts));
}

// The completionist overview and the detail lists behind it. Pure: the page and tests hand facts in.

export type CompletionKind = "achievements" | "reputation" | "titles" | "quests";

export type OverviewCategory = {
  /** A slug: `achievements-quests`, `reputation`, `reputation-alliance-forces`, `titles`, `quests`. */
  id: string;
  label: string;
  kind: CompletionKind;
  /** The achievement category or the reputation header this bar breaks down. */
  group?: string;
  done: number;
  total: number;
  points?: { have: number; of: number };
};

export type Overview = { total: { done: number; total: number }; categories: OverviewCategory[] };

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/** Done on this character, as the game's window counts it: complete, and not earned by another character of the account. */
const achievementDone = (c: OwnedCharacter | null, id: number) => {
  const a = c?.achievements.get(id);
  return Boolean(a && a.completed && a.earnedByMe !== false);
};
const factionDone = (c: OwnedCharacter | null, id: number) => c?.factions.get(id)?.reaction === TOP_REACTION;
const chainHave = (c: OwnedCharacter | null, chain: ChainEntry) => (c ? chain.questIds.filter((id) => c.quests.has(id)).length : 0);
const chainDone = (c: OwnedCharacter | null, chain: ChainEntry) => !chain.truncated && chainHave(c, chain) === chain.questIds.length;

/**
 * Every category the agreed lists hold, with one character's count through each. With no character every `done`
 * is 0 and the totals are still the catalog's, so the overview reads as the game's completionist universe.
 * `total` adds each kind once: the achievement categories, reputation as a whole, titles and quest chains.
 * Reputation headers are a breakdown of the reputation bar and are not added again.
 */
export function overviewOf(facts: CompletionFacts, character?: OwnedCharacter | null): Overview {
  const c = character ?? null;
  const categories: OverviewCategory[] = [];
  const total = { done: 0, total: 0 };
  const add = (cat: OverviewCategory, counts: boolean) => {
    categories.push(cat);
    if (counts) { total.done += cat.done; total.total += cat.total; }
  };

  const achievementGroups = new Map<string, AchievementEntry[]>();
  for (const a of facts.achievements.values()) achievementGroups.set(a.category, [...(achievementGroups.get(a.category) ?? []), a]);
  for (const [category, entries] of [...achievementGroups].sort(([x], [y]) => x.localeCompare(y))) {
    const done = entries.filter((a) => achievementDone(c, a.achievementId));
    add({
      id: `achievements-${slugify(category) || "other"}`, label: category, kind: "achievements", group: category,
      done: done.length, total: entries.length,
      points: { have: done.reduce((sum, a) => sum + a.points, 0), of: entries.reduce((sum, a) => sum + a.points, 0) },
    }, true);
  }

  const factions = [...facts.factions.values()].filter((f) => !f.major);
  add({ id: "reputation", label: "Reputation", kind: "reputation", done: factions.filter((f) => factionDone(c, f.factionId)).length, total: factions.length }, true);
  const headers = new Map<string, FactionEntry[]>();
  for (const f of factions) if (f.header) headers.set(f.header, [...(headers.get(f.header) ?? []), f]);
  for (const [header, entries] of [...headers].sort(([x], [y]) => x.localeCompare(y))) {
    add({
      id: `reputation-${slugify(header) || "other"}`, label: header, kind: "reputation", group: header,
      done: entries.filter((f) => factionDone(c, f.factionId)).length, total: entries.length,
    }, false);
  }

  add({ id: "titles", label: "Titles", kind: "titles", done: c ? [...facts.titles.keys()].filter((id) => c.titles.has(id)).length : 0, total: facts.titles.size }, true);
  const chains = [...facts.chains.values()];
  add({ id: "quests", label: "Quest chains", kind: "quests", done: chains.filter((chain) => chainDone(c, chain)).length, total: chains.length }, true);

  return { total, categories };
}

export type AchievementRow = {
  kind: "achievements"; entry: AchievementEntry; done: boolean; earnedOn?: string;
  /** Present while the achievement is started and not done: criteria met, or the progress bar's quantity. */
  progress?: { have: number; of: number; unit: "criteria" | "progress" };
};
export type FactionRow = {
  kind: "reputation"; entry: FactionEntry; done: boolean;
  /** The standing the character holds and how much reputation the next one needs; absent when the character has no row. */
  standing?: string; toNext?: number;
  /** A row whose scale is not the eight standings: the raw value only. */
  value?: number;
};
export type TitleRow = { kind: "titles"; entry: TitleEntry; done: boolean };
export type ChainRow = { kind: "quests"; entry: ChainEntry; done: boolean; have: number; total: number; truncated: boolean };
export type CompletionRows = { achievements: AchievementRow; reputation: FactionRow; titles: TitleRow; quests: ChainRow };

/** Every agreed entry of one kind with the character's state against it, by name. Major factions are left out, as in the counts. */
export function rowsOf<K extends CompletionKind>(facts: CompletionFacts, character: OwnedCharacter | null | undefined, kind: K): CompletionRows[K][] {
  const c = character ?? null;
  let rows: AchievementRow[] | FactionRow[] | TitleRow[] | ChainRow[];
  if (kind === "achievements") {
    rows = [...facts.achievements.values()].sort(byName).map((entry): AchievementRow => {
      const a = c?.achievements.get(entry.achievementId);
      if (achievementDone(c, entry.achievementId)) return { kind: "achievements", entry, done: true, ...(a?.earnedOn ? { earnedOn: a.earnedOn } : {}) };
      let progress: AchievementRow["progress"];
      if (a && !a.completed) {
        if (a.required && a.quantity !== undefined && a.quantity < a.required) progress = { have: a.quantity, of: a.required, unit: "progress" };
        else if (a.criteriaTotal > 0 && a.criteriaMet > 0 && a.criteriaMet < a.criteriaTotal) progress = { have: a.criteriaMet, of: a.criteriaTotal, unit: "criteria" };
      }
      return { kind: "achievements", entry, done: false, ...(progress ? { progress } : {}) };
    });
  } else if (kind === "reputation") {
    rows = [...facts.factions.values()].filter((f) => !f.major).sort(byName).map((entry): FactionRow => {
      const f = c?.factions.get(entry.factionId);
      if (!f) return { kind: "reputation", entry, done: false };
      const scaled = f.reaction >= 1 && f.reaction <= TOP_REACTION;
      if (!scaled) return { kind: "reputation", entry, done: false, value: f.standing };
      if (f.reaction === TOP_REACTION) return { kind: "reputation", entry, done: true, standing: STANDING_NAMES[TOP_REACTION - 1] };
      return { kind: "reputation", entry, done: false, standing: STANDING_NAMES[f.reaction - 1], ...(f.ceiling > f.standing ? { toNext: f.ceiling - f.standing } : {}) };
    });
  } else if (kind === "titles") {
    rows = [...facts.titles.values()].sort(byName).map((entry): TitleRow => ({ kind: "titles", entry, done: Boolean(c?.titles.has(entry.titleId)) }));
  } else {
    rows = [...facts.chains.values()].sort(byName).map((entry): ChainRow => ({
      kind: "quests", entry, done: chainDone(c, entry), have: chainHave(c, entry), total: entry.questIds.length, truncated: entry.truncated,
    }));
  }
  return rows as CompletionRows[K][];
}

/** The agreed entries this character has not completed, reached, known or finished, by name, with the owned state when partial. */
export function missingOf<K extends CompletionKind>(facts: CompletionFacts, character: OwnedCharacter | null | undefined, kind: K): CompletionRows[K][] {
  return rowsOf(facts, character, kind).filter((row) => !row.done);
}

/** The agreed entries this character has done, by name; an achievement carries `earnedOn` when the upload did. */
export function doneOf<K extends CompletionKind>(facts: CompletionFacts, character: OwnedCharacter | null | undefined, kind: K): CompletionRows[K][] {
  return rowsOf(facts, character, kind).filter((row) => row.done);
}
