/**
 * The worked example on /methodology and in the plan (section 3.2). MADE-UP DATA: no boss, list, install or
 * character here is real. It runs the real formula, so the numbers the page prints are the ones the code gives.
 */
import type { AchievementEntry, CompletionFacts, FactionEntry, OwnedCharacter, TitleEntry } from "./completion.js";
import {
  characterId, scoreAccount, scoreCharacter,
  type AccountScore, type CharacterScore, type OwnKill, type ScoreContext, type ScoreInstance, type WitnessKill,
} from "./everloot-score.js";

const range = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i);

export const EXAMPLE_LAUNCH = "2026-11-04T23:00:00.000Z";
const KILLED_AT = "2026-11-20T20:00:00.000Z";
const RECEIVED_AT = "2026-11-21T10:00:00.000Z";
const INSTALL = "example-install";

/** A tier-1 raid of 10 bosses and three dungeons of 5, each dungeon's last boss its final one. */
export const EXAMPLE_INSTANCES: ScoreInstance[] = [
  { instanceMapId: 1, kind: "raid", bosses: range(10, 101), minLevel: 60 },
  ...[2, 3, 4].map((id): ScoreInstance => ({ instanceMapId: id, kind: "dungeon", bosses: range(5, id * 100 + 1), finalBoss: id * 100 + 5, minLevel: 50 })),
];

/** The made-up lists: 60 achievements of 10 points, 12 factions, 10 titles and 300 quests, each agreed by 3 installs. */
export const EXAMPLE_LISTS = { achievements: 60, achievementPoints: 10, factions: 12, titles: 10, quests: 300 };

/** The made-up account's three characters, all level 60 on one install. Character A is the plan's example. */
export const EXAMPLE_CHARACTERS = [
  {
    key: "0000000a", name: "Character A",
    // 4 raid bosses; in each dungeon 4 bosses, the final one among them.
    kills: [...range(4, 101), ...range(4, 202), ...range(4, 302), ...range(4, 402)],
    done: { achievements: 41, exalted: 2, titles: 1, quests: 180 },
  },
  { key: "0000000b", name: "Character B", kills: [], done: { achievements: 20, exalted: 1, titles: 0, quests: 100 } },
  { key: "0000000c", name: "Character C", kills: [201, 301], done: { achievements: 5, exalted: 0, titles: 0, quests: 60 } },
];

function owned(key: string, done: (typeof EXAMPLE_CHARACTERS)[number]["done"]): OwnedCharacter {
  return {
    installId: INSTALL, characterKey: key, class: "WARRIOR", level: 60,
    achievements: new Map(range(done.achievements).map((id) => [id, { completed: true, criteriaMet: 1, criteriaTotal: 1 }])),
    factions: new Map(range(done.exalted).map((id) => [id, { reaction: 8, standing: 42_000, floor: 42_000, ceiling: 42_999 }])),
    titles: new Set(range(done.titles)),
    quests: new Set(range(done.quests)),
  };
}

const completion: CompletionFacts = {
  achievements: new Map(range(EXAMPLE_LISTS.achievements).map((id): [number, AchievementEntry] => [id, { achievementId: id, name: `Example ${id}`, category: "Example", points: EXAMPLE_LISTS.achievementPoints, criteriaCount: 1 }])),
  factions: new Map(range(EXAMPLE_LISTS.factions).map((id): [number, FactionEntry] => [id, { factionId: id, name: `Example ${id}`, major: false }])),
  titles: new Map(range(EXAMPLE_LISTS.titles).map((id): [number, TitleEntry] => [id, { titleId: id, name: `Example ${id}` }])),
  chains: new Map(),
  owned: EXAMPLE_CHARACTERS.map((c) => owned(c.key, c.done)),
};

const instanceOf = (encounterId: number) => EXAMPLE_INSTANCES.find((i) => i.bosses.includes(encounterId))!.instanceMapId;
const kills: OwnKill[] = EXAMPLE_CHARACTERS.flatMap((c) => c.kills.map((encounterId) => ({
  installId: INSTALL, characterKey: c.key, encounterId, instanceMapId: instanceOf(encounterId), difficulty: 1, success: true, capturedAt: KILLED_AT, receivedAt: RECEIVED_AT,
})));
// Every kill was also seen by two other players' installs, from two other addresses, in the same minute.
const witnesses: WitnessKill[] = kills.flatMap((k) => ["example-witness-1", "example-witness-2"].map((installId, i) => ({
  installId, reporter: `example-address-${i}`, encounterId: k.encounterId, difficulty: 1, success: true, capturedAt: KILLED_AT,
})));

export const EXAMPLE_CONTEXT: ScoreContext = {
  asOf: new Date("2026-11-22T00:00:00.000Z"),
  launch: EXAMPLE_LAUNCH,
  progress: {
    instances: EXAMPLE_INSTANCES,
    raidTiers: new Map([[1, 1]]),
    seasonStart: EXAMPLE_LAUNCH,
    kills,
    witnesses,
    guildKills: [],
    recorders: new Set(EXAMPLE_CHARACTERS.map((c) => characterId(INSTALL, c.key))),
    guilds: new Map(),
  },
  completion,
  agreedQuests: new Set(range(EXAMPLE_LISTS.quests)),
  contested: new Set(),
};

export const EXAMPLE_SCORES: CharacterScore[] = EXAMPLE_CHARACTERS.map((c) => scoreCharacter({ installId: INSTALL, characterKey: c.key }, EXAMPLE_CONTEXT));
export const EXAMPLE_ACCOUNT: AccountScore = scoreAccount(
  EXAMPLE_SCORES.map((score) => ({ score, link: "linked", hidden: false, sourceOwned: true, ruleset: "forever" })),
  "forever",
);
