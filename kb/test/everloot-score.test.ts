import { describe, expect, test } from "vitest";
import type { CompletionFacts, OwnedCharacter } from "../src/completion.js";
import {
  characterId, CLOCK_SKEW_MINUTES, COMPLETION_PARTS, independentWitnesses, LEVEL_SLACK, scoreAccount, scoreCharacter, SCORE_VERSION,
  type AccountCharacter, type CharacterScore, type CompletionPart, type ComponentScore, type OwnKill, type ProgressFacts, type PullWitness,
  type ScoreContext, type ScoreInstance,
} from "../src/everloot-score.js";
import { EXAMPLE_ACCOUNT, EXAMPLE_CHARACTERS, EXAMPLE_SCORES } from "../src/everloot-score-example.js";

// SYNTHETIC data throughout: the ids, installs, addresses and keys are made up.
const INSTALL = "install-one";
const ADDRESS = "address-home";
const KEY = "0a1b2c3d";
const ME = { installId: INSTALL, characterKey: KEY };
const MY_ID = characterId(INSTALL, KEY);
const LAUNCH = "2026-11-04T23:00:00.000Z";
const AT = "2026-11-10T20:00:00.000Z";
const RECEIVED = "2026-11-11T08:00:00.000Z";
const minutes = (iso: string, n: number) => new Date(Date.parse(iso) + n * 60_000).toISOString();

/** A tier-2 raid (bosses 10, 11) and a dungeon (bosses 1, 2, 3), levels 60 and 30, each with difficulties 1 and 2. */
const INSTANCES: ScoreInstance[] = [
  { instanceMapId: 200, kind: "raid", bosses: [10, 11], difficulties: [1, 2], minLevel: 60 },
  { instanceMapId: 100, kind: "dungeon", bosses: [1, 2, 3], difficulties: [1, 2], minLevel: 30 },
];

const kill = (encounterId: number, fields: Partial<OwnKill> = {}): OwnKill => ({
  installId: INSTALL, addressHash: ADDRESS, characterKey: KEY, encounterId, instanceMapId: encounterId >= 10 ? 200 : 100, difficulty: 1,
  success: true, capturedAt: AT, receivedAt: RECEIVED, ...fields,
});
/** Another install, from another address, uploaded a pull summary of this kill that lists the character. */
const seen = (encounterId: number, fields: Partial<PullWitness> = {}): PullWitness[] => [{
  installId: "witness-1", addressHash: "address-1", encounterId, difficulty: 1, success: true, capturedAt: AT, receivedAt: RECEIVED, members: [MY_ID], ...fields,
}];

function progress(kills: OwnKill[], pullSummaries: PullWitness[] = kills.flatMap((k) => seen(k.encounterId, { difficulty: k.difficulty })), fields: Partial<ProgressFacts> = {}): ProgressFacts {
  return {
    instances: INSTANCES, raidTiers: new Map([[200, 2]]), finalBosses: new Set([3]), seasonStart: LAUNCH, kills, pullSummaries,
    reports: { encounters: [], guildKills: [] }, recorders: new Set([MY_ID]), guilds: new Map(), ...fields,
  };
}

function owned(fields: Partial<OwnedCharacter> = {}): OwnedCharacter {
  return { installId: INSTALL, characterKey: KEY, class: "MAGE", level: 60, achievements: new Map(), factions: new Map(), titles: new Set(), quests: new Set(), ...fields };
}

type Earned = OwnedCharacter["achievements"] extends Map<number, infer V> ? V : never;
const done: Earned = { completed: true, criteriaMet: 1, criteriaTotal: 1 };
const exalted = { reaction: 8, standing: 42_000, floor: 42_000, ceiling: 42_999 };

/** Agreed lists: achievements of 10, 30 and 0 points, two factions plus a major one, two titles. */
function lists(own: OwnedCharacter[] = [owned()]): CompletionFacts {
  return {
    achievements: new Map([
      [1, { achievementId: 1, name: "One", category: "General", points: 10, criteriaCount: 1 }],
      [2, { achievementId: 2, name: "Two", category: "General", points: 30, criteriaCount: 1 }],
      [3, { achievementId: 3, name: "A statistic", category: "Statistics", points: 0, criteriaCount: 1 }],
    ]),
    factions: new Map([
      [1, { factionId: 1, name: "Plain one", major: false }],
      [2, { factionId: 2, name: "Plain two", major: false }],
      [3, { factionId: 3, name: "Major", major: true }],
    ]),
    titles: new Map([[1, { titleId: 1, name: "One" }], [2, { titleId: 2, name: "Two" }]]),
    chains: new Map(),
    owned: own,
  };
}
const noLists = (own: OwnedCharacter[] = []): CompletionFacts => ({ achievements: new Map(), factions: new Map(), titles: new Map(), chains: new Map(), owned: own });
const covered = (parts: readonly CompletionPart[] = COMPLETION_PARTS) => new Map([[MY_ID, new Set(parts)]]);

function context(fields: Partial<ScoreContext> = {}): ScoreContext {
  return {
    asOf: new Date("2026-11-20T00:00:00.000Z"), launch: LAUNCH, progress: progress([]), completion: lists(), completionCoverage: covered(),
    agreedQuests: new Set([1, 2, 3]), contested: new Set(), ...fields,
  };
}

const points = (c: ComponentScore) => (c.status === "scored" ? c.points : null);
const part = (c: ComponentScore, key: string) => (c.status === "scored" ? c.parts.find((p) => p.key === key) : undefined);
const progressOf = (kills: OwnKill[], witnesses?: PullWitness[], fields: Partial<ProgressFacts> = {}, ctx: Partial<ScoreContext> = {}) =>
  scoreCharacter(ME, context({ progress: progress(kills, witnesses, fields), ...ctx }));

describe("a character with no data", () => {
  test("is unknown, not zero, and has no total", () => {
    const s = scoreCharacter(ME, context({ progress: progress([], [], { recorders: new Set() }), completion: lists([]) }));
    expect(s.progress).toEqual({ key: "progress", status: "unknown", missing: "own boss kills" });
    expect(s.completion).toEqual({ key: "completion", status: "unknown", missing: "own completion rows" });
    expect(s.total).toBeNull();
  });

  test("before anything is recorded for anyone, nothing is scored", () => {
    const s = scoreCharacter(ME, context({ progress: null, completion: noLists(), agreedQuests: null }));
    expect(s.progress.status).toBe("not-scored");
    expect(s.completion.status).toBe("not-scored");
    expect(s.total).toBeNull();
  });

  test("a synced character with no kill has measured zero", () => {
    const s = scoreCharacter(ME, context());
    expect(s.progress).toEqual({ key: "progress", status: "scored", points: 0, parts: [{ key: "raid", count: 0, points: 0 }, { key: "dungeon", count: 0, points: 0 }] });
    expect(s.total).toBe(0);
  });

  test("today, with no own kills recorded for anyone, the total is Completion alone", () => {
    const s = scoreCharacter(ME, context({ progress: null, completion: lists([owned({ titles: new Set([1]) })]) }));
    expect(s.progress.status).toBe("not-scored");
    expect(s.total).toBe(5);
  });
});

describe("Progress", () => {
  test("a raid boss is worth 10 times its tier, a dungeon boss 1 and a listed final boss 3", () => {
    const s = progressOf([kill(10), kill(1), kill(3)]);
    expect(part(s.progress, "raid")).toEqual({ key: "raid", count: 1, points: 20 });
    expect(part(s.progress, "dungeon")).toEqual({ key: "dungeon", count: 2, points: 4 });
    expect(points(s.progress)).toBe(24);
    expect(s.kills.counted).toEqual(["10:1", "1:1", "3:1"].sort());
  });

  test("until the curated final-boss list exists, every dungeon boss is worth 1", () => {
    expect(part(progressOf([kill(1), kill(3)], undefined, { finalBosses: null }).progress, "dungeon")).toEqual({ key: "dungeon", count: 2, points: 2 });
  });

  test("each boss counts once per difficulty", () => {
    const later = "2026-11-10T21:00:00.000Z";
    const s = progressOf([kill(1), kill(1, { capturedAt: later }), kill(1, { difficulty: 2 })], [...seen(1), ...seen(1, { capturedAt: later }), ...seen(1, { difficulty: 2 })]);
    expect(points(s.progress)).toBe(2);
    expect(s.kills.dropped).toEqual({ repeat: 1 });
  });

  test("only the character's own rows count", () => {
    const s = progressOf([
      kill(10, { installId: "another-install" }), // the same key on another install
      kill(10, { characterKey: "ffffffff" }), // another character of the install
    ]);
    expect(points(s.progress)).toBe(0);
    expect(s.kills.dropped).toEqual({});
  });

  test("install and key match however they were spelled", () => {
    const s = scoreCharacter({ installId: ` ${INSTALL} `, characterKey: KEY.toUpperCase() }, context({ progress: progress([kill(1)]) }));
    expect(points(s.progress)).toBe(1);
    expect(s.characterKey).toBe(KEY);
  });
});

describe("the anti-gaming rules (plan section 3.3)", () => {
  test("a wipe scores nothing", () => {
    expect(progressOf([kill(1, { success: false })]).kills.dropped).toEqual({ wipe: 1 });
  });

  test("a boss off the agreed list, or reported in another instance, scores nothing", () => {
    const s = progressOf([kill(99), kill(1, { instanceMapId: 200 })]);
    expect(points(s.progress)).toBe(0);
    expect(s.kills.dropped).toEqual({ "not on the boss list": 2 });
  });

  test("a difficulty the instance does not have scores nothing", () => {
    expect(progressOf([kill(1, { difficulty: 9 })]).kills.dropped).toEqual({ "difficulty not valid": 1 });
    // An instance the files give no difficulty for scores nothing at all.
    expect(progressOf([kill(1)], undefined, { instances: [INSTANCES[0], { ...INSTANCES[1], difficulties: [] }] }).kills.dropped).toEqual({ "difficulty not valid": 1 });
  });

  test("an instance of unknown kind scores nothing", () => {
    const s = progressOf([kill(1)], undefined, { instances: [{ ...INSTANCES[1], kind: null }] });
    expect(s.kills.dropped).toEqual({ "not on the boss list": 1 });
  });

  test("a raid off the tier list scores nothing", () => {
    expect(progressOf([kill(10)], undefined, { raidTiers: new Map() }).kills.dropped).toEqual({ "raid not on the tier list": 1 });
  });

  describe("confirmation by another uploader's pull summary", () => {
    test("one pull summary from another install and another address, listing the character, confirms the kill", () => {
      expect(points(progressOf([kill(1)]).progress)).toBe(1);
      const none = progressOf([kill(1)], []);
      expect(none.kills.dropped).toEqual({ "not confirmed": 1 });
      expect(points(none.progress)).toBe(0);
    });

    test("a pull summary that does not list the character confirms nothing", () => {
      expect(progressOf([kill(1)], seen(1, { members: [characterId("witness-1", "ffffffff")] })).kills.dropped).toEqual({ "not confirmed": 1 });
    });

    test("the character's own install, or its own address, is never a witness", () => {
      // The upload that carried the kill came from ADDRESS: a second install behind it is the same uploader's.
      expect(progressOf([kill(1)], seen(1, { addressHash: ADDRESS })).kills.dropped).toEqual({ "not confirmed": 1 });
      expect(progressOf([kill(1)], seen(1, { installId: INSTALL })).kills.dropped).toEqual({ "not confirmed": 1 });
    });

    test("witnesses are counted as independent (install, address) pairs", () => {
      const subject = { installId: "S", addressHash: "s" };
      const pair = (installId: string, addressHash: string) => ({ installId, addressHash });
      // Three installs and three addresses, but one address behind three installs and one install behind three
      // addresses: only two pairs share nothing. Counting installs and addresses apart would say three.
      expect(independentWitnesses([pair("A", "x"), pair("B", "x"), pair("C", "x"), pair("A", "y"), pair("A", "z")], subject)).toBe(2);
      expect(independentWitnesses([pair("A", "x"), pair("A", "y")], subject)).toBe(1);
      expect(independentWitnesses([pair("A", "s"), pair("S", "x")], subject)).toBe(0);
      expect(independentWitnesses([pair("A", "x"), pair("B", "y")], subject)).toBe(2);
    });

    test("needs the same boss, difficulty and a kill, within ten minutes", () => {
      for (const witness of [{ encounterId: 2 }, { difficulty: 2 }, { success: false }, { capturedAt: "2026-11-10T20:10:01.000Z" }]) {
        expect(progressOf([kill(1)], seen(1, witness)).kills.dropped, JSON.stringify(witness)).toEqual({ "not confirmed": 1 });
      }
      expect(points(progressOf([kill(1)], seen(1, { capturedAt: "2026-11-10T20:10:00.000Z" })).progress)).toBe(1);
    });

    test("a witness dated past its own arrival, or arriving after the server's clock, confirms nothing", () => {
      const asOf = new Date("2026-11-10T20:30:00.000Z");
      const k = kill(1, { receivedAt: "2026-11-10T20:20:00.000Z" });
      const witness = (capturedAt: string, receivedAt: string) => progressOf([k], seen(1, { capturedAt, receivedAt }), {}, { asOf });
      // The witness's upload arrived at 20:00; it may claim a time up to the skew after that, and no later.
      const ahead = minutes(AT, CLOCK_SKEW_MINUTES);
      expect(points(witness(ahead, AT).progress)).toBe(1);
      expect(witness(new Date(Date.parse(ahead) + 1000).toISOString(), AT).kills.dropped).toEqual({ "not confirmed": 1 });
      expect(witness(AT, "2026-11-10T20:30:01.000Z").kills.dropped).toEqual({ "not confirmed": 1 });
    });

    test("ignores witnesses from contested installs", () => {
      expect(progressOf([kill(1)], undefined, {}, { contested: new Set(["witness-1"]) }).kills.dropped).toEqual({ "not confirmed": 1 });
    });

    test("the guild's kill or other installs' anonymous rows label a kill reported, and score nothing", () => {
      const guild = { guildName: "Example Guild", realm: "Example" };
      const guilds = new Map([[MY_ID, guild]]);
      const guildKill = { ...guild, encounterId: 1, difficulty: 1, killedAt: "2026-11-10T23:30:00.000Z" };
      const byGuild = progressOf([kill(1)], [], { guilds, reports: { encounters: [], guildKills: [guildKill] } });
      expect(points(byGuild.progress)).toBe(0);
      expect(byGuild.kills.dropped).toEqual({ "reported, not confirmed": 1 });
      const anonymous = [1, 2].map((n) => ({ installId: `other-${n}`, encounterId: 1, difficulty: 1, success: true, capturedAt: AT }));
      const byRows = progressOf([kill(1)], [], { reports: { encounters: anonymous, guildKills: [] } });
      expect(points(byRows.progress)).toBe(0);
      expect(byRows.kills.dropped).toEqual({ "reported, not confirmed": 1 });
      // The label needs the same difficulty and day, and the character's own guild.
      for (const g of [{ ...guildKill, difficulty: 2 }, { ...guildKill, difficulty: null }, { ...guildKill, killedAt: "2026-11-11T00:30:00.000Z" }, { ...guildKill, guildName: "Other" }]) {
        expect(progressOf([kill(1)], [], { guilds, reports: { encounters: [], guildKills: [g] } }).kills.dropped, JSON.stringify(g)).toEqual({ "not confirmed": 1 });
      }
    });

    test("one guild kill against many difficulty variants of the same boss scores nothing", () => {
      const guild = { guildName: "Example Guild", realm: "Example" };
      const variants = Array.from({ length: 20 }, (_, d) => kill(10, { difficulty: d + 1 }));
      const s = progressOf(variants, [], { guilds: new Map([[MY_ID, guild]]), reports: { encounters: [], guildKills: [{ ...guild, encounterId: 10, difficulty: 1, killedAt: AT }] } });
      expect(points(s.progress)).toBe(0);
      expect(s.kills.dropped).toEqual({ "reported, not confirmed": 1, "difficulty not valid": 18, "not confirmed": 1 });
    });

    test("a later confirmed kill of the same boss still counts", () => {
      const later = "2026-11-12T20:00:00.000Z";
      const s = progressOf([kill(1), kill(1, { capturedAt: later, receivedAt: later })], seen(1, { capturedAt: later, receivedAt: later }));
      expect(points(s.progress)).toBe(1);
      expect(s.kills.dropped).toEqual({ "not confirmed": 1 });
    });
  });

  test("a character under the level band scores nothing there", () => {
    const low = (level: number) => scoreCharacter({ ...ME, level }, context({ progress: progress([kill(10)]) }));
    expect(low(60 - LEVEL_SLACK - 1).kills.dropped).toEqual({ "under the level band": 1 });
    expect(points(low(60 - LEVEL_SLACK).progress)).toBe(20);
    // The completion rows' level stands in when the link gives none.
    expect(points(scoreCharacter(ME, context({ progress: progress([kill(10)]), completion: lists([owned({ level: 20 })]) })).progress)).toBe(0);
  });

  test("an unknown character level makes Progress unknown, not zero", () => {
    // No link level and no completion rows: the level cannot be checked.
    const unknown = scoreCharacter(ME, context({ progress: progress([kill(10)]), completion: lists([]) }));
    expect(unknown.kills.dropped).toEqual({ "level unknown": 1 });
    expect(unknown.progress).toEqual({ key: "progress", status: "unknown", missing: "character level" });
    expect(unknown.total).toBeNull();
    // A level that is not a level is unknown too.
    expect(scoreCharacter({ ...ME, level: 0 }, context({ progress: progress([kill(10)]), completion: lists([owned({ level: 0 })]) })).progress.status).toBe("unknown");
  });

  test("an instance with no level in the files scores nothing: the band cannot be checked", () => {
    const noLevel = [{ ...INSTANCES[0], minLevel: undefined }, INSTANCES[1]];
    const s = progressOf([kill(10)], undefined, { instances: noLevel });
    expect(s.kills.dropped).toEqual({ "instance level unknown": 1 });
    expect(points(s.progress)).toBe(0);
    // Even when the character's own level is unknown.
    expect(scoreCharacter(ME, context({ progress: progress([kill(10)], undefined, { instances: noLevel }), completion: lists([]) })).kills.dropped)
      .toEqual({ "instance level unknown": 1 });
  });

  test("dates: nothing before launch or the season, dated past its arrival, arriving after the server's clock, or over 60 days late", () => {
    const cases: [Partial<OwnKill>, string][] = [
      [{ capturedAt: "2026-11-04T22:59:59.000Z", receivedAt: "2026-11-05T00:00:00.000Z" }, "before the season"],
      [{ capturedAt: "2026-11-19T00:00:00.000Z", receivedAt: "2026-11-20T00:00:01.000Z" }, "date out of range"],
      [{ capturedAt: "2026-11-11T08:10:01.000Z", receivedAt: "2026-11-11T08:00:00.000Z" }, "date out of range"],
      [{ capturedAt: "not a date" }, "date out of range"],
    ];
    for (const [fields, why] of cases) {
      expect(progressOf([kill(1, fields)], seen(1, { capturedAt: fields.capturedAt ?? AT, receivedAt: fields.receivedAt ?? RECEIVED })).kills.dropped, why).toEqual({ [why]: 1 });
    }
    // Ten minutes ahead of its arrival is the allowed skew.
    const ahead = "2026-11-11T08:10:00.000Z";
    expect(points(progressOf([kill(1, { capturedAt: ahead })], seen(1, { capturedAt: ahead })).progress)).toBe(1);
    // Intake takes a kill up to 60 days old at its upload; older is out of range.
    const late = (receivedAt: string) => progressOf([kill(1, { receivedAt })], seen(1), {}, { asOf: new Date("2027-01-20T00:00:00.000Z") });
    expect(points(late("2027-01-09T20:00:00.000Z").progress)).toBe(1);
    expect(late("2027-01-09T20:00:01.000Z").kills.dropped).toEqual({ "date out of range": 1 });
    // A new tier's season starts later: kills before it no longer count.
    expect(progressOf([kill(1)], undefined, { seasonStart: "2026-11-15T00:00:00.000Z" }).kills.dropped).toEqual({ "before the season": 1 });
  });

  test("a contested install's own rows do not count", () => {
    const s = scoreCharacter(ME, context({ progress: progress([kill(1)]), completion: lists([owned({ titles: new Set([1]) })]), contested: new Set([INSTALL]) }));
    expect(s.progress.status).toBe("unknown");
    expect(s.completion.status).toBe("unknown");
    expect(s.total).toBeNull();
  });
});

describe("Completion", () => {
  test("adds achievement points over 10, 10 per Exalted, 5 per title and 1 per 25 quests", () => {
    const quests = new Set(Array.from({ length: 60 }, (_, i) => i + 1));
    const me = owned({
      achievements: new Map([[1, done], [2, done], [3, done]]),
      factions: new Map([[1, exalted], [2, exalted]]),
      titles: new Set([1, 2]),
      quests,
    });
    const s = scoreCharacter(ME, context({ progress: null, completion: lists([me]), agreedQuests: quests }));
    expect(s.completion).toEqual({
      key: "completion", status: "scored", points: 4 + 20 + 10 + 2,
      parts: [
        { key: "achievements", count: 40, points: 4 },
        { key: "reputations", count: 2, points: 20 },
        { key: "titles", count: 2, points: 10 },
        { key: "quests", count: 60, points: 2 },
      ],
    });
  });

  test("counts only entries on the agreed lists, earned by this character, after launch", () => {
    const me = owned({
      achievements: new Map([
        [1, { ...done, earnedByMe: false }], // another character's
        [2, { ...done, earnedOn: "2026-11-01" }], // before launch
        [77, done], // not on the list
      ]),
      factions: new Map([[3, exalted], [2, { reaction: 12, standing: 5, floor: 0, ceiling: 10 }], [88, exalted]]), // major, renown-style, unlisted
      titles: new Set([55]),
      quests: new Set([9, 10]),
    });
    const s = scoreCharacter(ME, context({ progress: null, completion: lists([me]) }));
    expect(points(s.completion)).toBe(0);
    expect(s.total).toBe(0);
  });

  test("a kind of row the character never uploaded is unknown, not zero", () => {
    const me = owned({ achievements: new Map([[1, done], [2, done]]) });
    const partial = scoreCharacter(ME, context({ progress: null, completion: lists([me]), completionCoverage: covered(["achievements"]) }));
    expect(partial.completion).toEqual({ key: "completion", status: "unknown", missing: "own reputation, title, quest rows" });
    expect(partial.total).toBeNull();
    expect(scoreCharacter(ME, context({ progress: null, completion: lists([me]), completionCoverage: new Map() })).completion.status).toBe("unknown");
    // A kind with no agreed list is not needed: with no quest list, quests need not be uploaded.
    const noQuests = scoreCharacter(ME, context({ progress: null, completion: lists([me]), agreedQuests: null, completionCoverage: covered(["achievements", "reputations", "titles"]) }));
    expect(points(noQuests.completion)).toBe(4);
  });

  test("an achievement earned on launch day counts", () => {
    const me = owned({ achievements: new Map([[2, { ...done, earnedOn: "2026-11-04" }]]) });
    expect(part(scoreCharacter(ME, context({ progress: null, completion: lists([me]) })).completion, "achievements")?.points).toBe(3);
  });

  test("a completion upload under the same key from another install is not this character's", () => {
    const s = scoreCharacter(ME, context({ progress: null, completion: lists([owned({ installId: "another-install", titles: new Set([1, 2]) })]) }));
    expect(s.completion.status).toBe("unknown");
  });

  test("with no agreed quest list, Quests is left out for everyone", () => {
    const s = scoreCharacter(ME, context({ progress: null, agreedQuests: null }));
    expect(s.completion.status === "scored" && s.completion.parts.map((p) => p.key)).toEqual(["achievements", "reputations", "titles"]);
  });
});

describe("components stay apart", () => {
  test("Speed and PvP are defined and not scored", () => {
    const s = scoreCharacter(ME, context());
    expect(s.speed.status).toBe("not-scored");
    expect(s.pvp.status).toBe("not-scored");
  });

  test("Progress does not move when Completion changes, and the profile total is their sum", () => {
    const a = scoreCharacter(ME, context({ progress: progress([kill(10)]) }));
    const b = scoreCharacter(ME, context({ progress: progress([kill(10)]), completion: lists([owned({ titles: new Set([1, 2]) })]) }));
    expect(b.progress).toEqual(a.progress);
    expect([a.total, b.total]).toEqual([20, 30]);
  });
});

describe("a list change between game builds", () => {
  test("a boss that leaves the agreed list stops scoring; a new one adds points without lowering others", () => {
    const kills = [kill(1), kill(10)];
    expect(points(progressOf(kills).progress)).toBe(21);
    const without = [{ ...INSTANCES[1], bosses: [2, 3] }, INSTANCES[0]];
    expect(points(progressOf(kills, undefined, { instances: without }).progress)).toBe(20);
    const more = [{ ...INSTANCES[0], bosses: [10, 11, 12] }, INSTANCES[1]];
    expect(points(progressOf(kills, undefined, { instances: more }).progress)).toBe(21);
  });

  test("a final-boss list change moves only that boss's worth", () => {
    const kills = [kill(2), kill(3)];
    expect(points(progressOf(kills).progress)).toBe(4);
    expect(points(progressOf(kills, undefined, { finalBosses: new Set([2]) }).progress)).toBe(4);
    expect(points(progressOf(kills, undefined, { finalBosses: new Set() }).progress)).toBe(2);
  });

  test("an achievement's points come from the current list", () => {
    const me = owned({ achievements: new Map([[2, done]]) });
    const facts = lists([me]);
    expect(part(scoreCharacter(ME, context({ progress: null, completion: facts })).completion, "achievements")?.points).toBe(3);
    facts.achievements.set(2, { ...facts.achievements.get(2)!, points: 50 });
    expect(part(scoreCharacter(ME, context({ progress: null, completion: facts })).completion, "achievements")?.points).toBe(5);
    facts.achievements.delete(2);
    expect(part(scoreCharacter(ME, context({ progress: null, completion: facts })).completion, "achievements")?.points).toBe(0);
  });
});

describe("one account across its characters", () => {
  const scoreOf = (key: string, progressPoints: number | null, completionPoints: number | null, counted: string[] = []): CharacterScore => ({
    version: SCORE_VERSION, asOf: "2026-11-20T00:00:00.000Z", installId: INSTALL, characterKey: key,
    total: progressPoints === null || completionPoints === null ? null : progressPoints + completionPoints,
    progress: progressPoints === null ? { key: "progress", status: "unknown", missing: "own boss kills" } : { key: "progress", status: "scored", points: progressPoints, parts: [] },
    completion: completionPoints === null ? { key: "completion", status: "unknown", missing: "own completion rows" } : { key: "completion", status: "scored", points: completionPoints, parts: [] },
    speed: { key: "speed", status: "not-scored", reason: "" }, pvp: { key: "pvp", status: "not-scored", reason: "" },
    kills: { counted, dropped: {} },
  });
  const linked = (score: CharacterScore, fields: Partial<AccountCharacter> = {}): AccountCharacter => ({ score, link: "linked", hidden: false, sourceOwned: true, ruleset: "forever", ...fields });

  test("no characters, no score", () => {
    expect(scoreAccount([], "forever")).toMatchObject({ progress: null, completion: null, counted: 0, record: 0 });
  });

  test("one character is the account's Progress and Completion", () => {
    expect(scoreAccount([linked(scoreOf("00000001", 40, 400))], "forever")).toMatchObject({
      progress: { points: 40, characterKey: "00000001" }, completion: { points: 400, characterKey: "00000001" }, counted: 1,
    });
  });

  test("Progress and Completion each take their own best character; a big Completion never picks the Progress one", () => {
    const a = scoreAccount([
      linked(scoreOf("00000001", 10, 500, ["1:1"])), // the highest combined total
      linked(scoreOf("00000002", 100, 0, ["1:1", "10:1"])),
      linked(scoreOf("00000003", 50, 20, ["2:1"])),
    ], "forever");
    expect(a.progress).toEqual({ points: 100, installId: INSTALL, characterKey: "00000002" });
    expect(a.completion).toEqual({ points: 500, installId: INSTALL, characterKey: "00000001" });
    expect(a.counted).toBe(3);
    // The record is every distinct boss any of them killed.
    expect(a.record).toBe(3);
  });

  test("a character unknown in one number still counts in the other", () => {
    const a = scoreAccount([linked(scoreOf("00000001", null, 300)), linked(scoreOf("00000002", 30, null))], "forever");
    expect(a.progress?.characterKey).toBe("00000002");
    expect(a.completion?.characterKey).toBe("00000001");
  });

  test("frozen, hidden, other accounts' sources, other rulesets, nothing scored, old versions and repeats do not count", () => {
    const a = scoreAccount([
      linked(scoreOf("00000001", 30, 300)),
      linked(scoreOf("00000002", 90, 900), { link: "frozen" }),
      linked(scoreOf("00000003", 90, 900), { hidden: true }),
      linked(scoreOf("00000004", 90, 900), { sourceOwned: false }),
      linked(scoreOf("00000005", 90, 900), { ruleset: "another" }),
      linked(scoreOf("00000006", null, null)),
      linked({ ...scoreOf("00000007", 90, 900), version: SCORE_VERSION + 1 }),
      linked(scoreOf("00000001", 30, 300)),
    ], "forever");
    expect(a.progress?.points).toBe(30);
    expect(a.completion?.points).toBe(300);
    expect(a.counted).toBe(1);
    expect(a.excluded.map((e) => e.reason).sort()).toEqual(["frozen", "hidden", "listed twice", "nothing scored", "other ruleset", "other version", "source not owned"]);
  });

  test("equal points pick the same best character whatever the order", () => {
    const a = linked(scoreOf("0000000a", 50, 500));
    const b = linked(scoreOf("0000000b", 50, 500));
    expect(scoreAccount([a, b], "forever").progress?.characterKey).toBe("0000000a");
    expect(scoreAccount([b, a], "forever").completion?.characterKey).toBe("0000000a");
  });
});

describe("the worked example (plan section 3.2)", () => {
  test("Character A scores Raid 40, Dungeon 18, Achievements 41, Reputations 20, Titles 5, Quests 7: 131", () => {
    const [a, b, c] = EXAMPLE_SCORES;
    expect(EXAMPLE_CHARACTERS.map((x) => x.name)).toEqual(["Character A", "Character B", "Character C"]);
    const all = [a.progress, a.completion].flatMap((x) => (x.status === "scored" ? x.parts.map((p) => [p.key, p.points]) : []));
    expect(all).toEqual([["raid", 40], ["dungeon", 18], ["achievements", 41], ["reputations", 20], ["titles", 5], ["quests", 7]]);
    expect([points(a.progress), points(a.completion), a.total]).toEqual([58, 73, 131]);
    expect([b.total, c.total]).toEqual([34, 9]);
    expect(EXAMPLE_ACCOUNT).toMatchObject({ progress: { points: 58, characterKey: "0000000a" }, completion: { points: 73, characterKey: "0000000a" }, counted: 3, record: 18 });
  });
});
