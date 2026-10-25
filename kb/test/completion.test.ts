import { expect, test } from "vitest";
import { completionProgress, doneOf, handleCompletionProgress } from "../src/completion.js";
import {
  agreedCatalog, authorizedOwners, COMPLETION_LIMITS, completionFactsFromRecords, completionFactsOf, emptyCompletion, foldCompletion,
  trimCompletion,
} from "../src/completion-rollup.js";
import { answerCompletionProgress, COMPLETION_UNSET, completionProgressAnswer } from "../src/mcp-server.js";
import { sharingCategory, type PublicationGrant } from "../src/publication.js";
import { mergeCorpus, publicRecords } from "../src/corpus.js";
import { COMPLETION_KINDS, parseRecords, PUBLIC_RECORD_KINDS } from "@everloot/protocol";

const OWNER = "owner-install";
const KEY = "0a1b2c3d";
const at = (n: number) => `2026-10-${String(10 + n).padStart(2, "0")}T00:00:00Z`;
let seq = 0;
const row = (installId: string, fields: Record<string, unknown>, capturedAt = at(1)) =>
  ({ installId, eventId: `e:${++seq}`, capturedAt, ...fields });

/** The same catalog entry reported by three installs, so it is public. */
const three = (fields: Record<string, unknown>) => ["reporter-one", "reporter-two", "reporter-three"].map((id) => row(id, fields));
const owned = (fields: Record<string, unknown>, capturedAt = at(1), key = KEY) =>
  row(OWNER, { characterKey: key, class: "MAGE", level: 40, ...fields }, capturedAt);

const catalog = [
  ...three({ kind: "achievement_catalog", achievementId: 1, name: "Explore Kalimdor", categoryId: 10, category: "Exploration", points: 10, criteriaCount: 4, criteria: [] }),
  ...three({ kind: "achievement_catalog", achievementId: 2, name: "Ten Quests", categoryId: 11, category: "Quests", points: 5, criteriaCount: 10, criteria: [] }),
  ...three({ kind: "achievement_catalog", achievementId: 3, name: "Gather Herbs", categoryId: 12, category: "Professions", points: 5, criteriaCount: 3, criteria: [] }),
  ...three({ kind: "reputation_catalog", factionId: 72, name: "Stormwind", header: "Alliance" }),
  ...three({ kind: "reputation_catalog", factionId: 69, name: "Darnassus", header: "Alliance" }),
  ...three({ kind: "reputation_catalog", factionId: 2000, name: "Renown Guild", major: true }),
  ...three({ kind: "title_catalog", titleId: 4, name: "Private" }),
  ...three({ kind: "title_catalog", titleId: 5, name: "Corporal" }),
  ...three({ kind: "quest_chain_catalog", questLineId: 900, name: "The Defias", questIds: [7, 8, 9, 10] }),
  ...three({ kind: "quest_chain_catalog", questLineId: 901, name: "Westfall", questIds: [20, 21] }),
];

const progress = [
  owned({ kind: "achievement_owned", achievementId: 1, completed: true, earnedByMe: true, earnedOn: "2026-09-30", criteriaMet: 4, criteriaTotal: 4 }),
  owned({ kind: "achievement_owned", achievementId: 2, completed: false, criteriaMet: 8, criteriaTotal: 10 }),
  owned({ kind: "achievement_owned", achievementId: 3, completed: false, criteriaMet: 1, criteriaTotal: 3 }),
  owned({ kind: "reputation_owned", factionId: 72, reaction: 8, standing: 42000, floor: 42000, ceiling: 42999 }),
  owned({ kind: "reputation_owned", factionId: 69, reaction: 5, standing: 8500, floor: 3000, ceiling: 9000 }),
  owned({ kind: "reputation_owned", factionId: 2000, reaction: 3, standing: 100, floor: 0, ceiling: 2500 }),
  owned({ kind: "title_owned", titleIds: [4] }),
  owned({ kind: "quest_owned", questIds: [7, 8, 9, 20, 21, 999] }),
];

const facts = () => completionFactsFromRecords([...catalog, ...progress]);

test("the day an achievement was earned survives the rollup and reaches the character's rows", () => {
  const [c] = facts().owned;
  expect(c.achievements.get(1)?.earnedOn).toBe("2026-09-30");
  expect(c.achievements.get(2)?.earnedOn).toBeUndefined();
  const done = doneOf(facts(), c, "achievements");
  expect(done.map((r) => [r.entry.achievementId, r.earnedOn])).toEqual([[1, "2026-09-30"]]);
});

test("what is done and what is closest to done, per character", () => {
  const result = completionProgress(OWNER, undefined, facts());
  expect(result.listed).toEqual({ achievements: 3, factions: 3, titles: 2, chains: 2 });
  const [c] = result.characters;
  expect(c.characterKey).toBe(KEY);
  expect(c.achievements.done).toBe(1);
  expect(c.achievements.points).toBe(10);
  expect(c.achievements.closest.map((a) => a.name)).toEqual(["Ten Quests", "Gather Herbs"]);
  // A renown faction is not one of the eight standings, so it is neither counted nor ranked.
  expect(c.reputation).toMatchObject({ exalted: 1, total: 2 });
  expect(c.reputation.closest).toEqual([expect.objectContaining({ name: "Darnassus", standing: "Friendly", toNext: 500 })]);
  expect(c.titles).toMatchObject({ known: 1, total: 2 });
  expect(c.quests.completed).toBe(6);
  expect(c.quests.chainsDone).toBe(1);
  expect(c.quests.closest).toEqual([{ questLineId: 900, name: "The Defias", done: 3, total: 4, truncated: false }]);
  expect(c.achievements.unlisted + c.titles.unlisted).toBe(0);
});

test("an entry nobody else reported, or reported differently, stays off the list", () => {
  const lonely = row("reporter-one", { kind: "title_catalog", titleId: 6, name: "Sergeant" });
  const split = ["reporter-one", "reporter-two", "reporter-three"].map((id, i) =>
    row(id, { kind: "title_catalog", titleId: 7, name: `Variant ${i}` }));
  const result = completionProgress(OWNER, undefined, completionFactsFromRecords([...catalog, lonely, ...split, ...progress]));
  expect(result.listed.titles).toBe(2);
});

test("the later row wins for an achievement, and an account-only completion is not done", () => {
  const later = [
    owned({ kind: "achievement_owned", achievementId: 2, completed: true, earnedByMe: true, earnedOn: "2026-10-20", criteriaMet: 10, criteriaTotal: 10 }, at(9)),
    owned({ kind: "achievement_owned", achievementId: 3, completed: true, earnedByMe: false, criteriaMet: 3, criteriaTotal: 3 }, at(9)),
  ];
  const [c] = completionProgress(OWNER, undefined, completionFactsFromRecords([...catalog, ...progress, ...later])).characters;
  expect(c.achievements.done).toBe(2);
  expect(c.achievements.closest).toEqual([]);
});

test("a character key narrows the answer, and an unknown key is said so", () => {
  const second = [owned({ kind: "title_owned", titleIds: [5] }, at(1), "ffffffff")];
  const all = completionFactsFromRecords([...catalog, ...progress, ...second]);
  expect(completionProgress(OWNER, undefined, all).characters.map((c) => c.characterKey)).toEqual([KEY, "ffffffff"]);
  expect(completionProgress(OWNER, "FFFFFFFF", all).characters.map((c) => c.characterKey)).toEqual(["ffffffff"]);
  expect(handleCompletionProgress({ ownerInstallId: OWNER, characterKey: "12345678" }, all)).toContain("No character 12345678");
});

test("an install with no upload is unrecorded, not zero, and a blank install is refused", () => {
  const text = handleCompletionProgress({ ownerInstallId: "stranger-install" }, facts());
  expect(text).toContain("unrecorded, not zero");
  expect(text).toContain("/everloot completion on");
  expect(handleCompletionProgress({ ownerInstallId: " " })).toBe("Name the install.");
});

test("owned rows with no agreed list say the lists are unrecorded", () => {
  const text = handleCompletionProgress({ ownerInstallId: OWNER }, completionFactsFor(progress));
  expect(text).toContain("Lists unrecorded");
  expect(text).toContain("Achievements: 0 of 0 done");
});

function completionFactsFor(records: object[]) {
  return completionFactsFromRecords(records);
}

test("another install's progress is never read for this install", () => {
  const other = [owned({ kind: "title_owned", titleIds: [4, 5] })].map((r) => ({ ...r, installId: "someone-else" }));
  const text = handleCompletionProgress({ ownerInstallId: "someone-else-2" }, completionFactsFor([...catalog, ...progress, ...other]));
  expect(text).toContain("unrecorded, not zero");
});

test("the text answer carries the closest lines", () => {
  const text = handleCompletionProgress({ ownerInstallId: OWNER }, facts());
  expect(text).toContain("Ten Quests (Quests): 8 of 10 criteria");
  expect(text).toContain("Darnassus: Friendly, 500 to the next standing");
  expect(text).toContain("The Defias: 3 of 4 quests");
});

// --- who may see owned rows -------------------------------------------------------------------

const hash = "a".repeat(64);
const grant: PublicationGrant = { tokenHash: hash, installId: OWNER, realm: "Forever", subjectType: "install", subject: OWNER,
  categories: ["collection"], expiresAt: "2026-11-30T00:00:00Z", verifiedBy: "operator", evidence: "test", revokedAt: null };
const now = new Date("2026-10-15T00:00:00Z");

test("owned progress is in the collection sharing category, like collection_owned", () => {
  const parsed = parseRecords([...catalog, ...progress]);
  expect(parsed.receipt.rejected).toEqual([]);
  for (const r of parsed.records) expect(sharingCategory(r), r.kind).toBe(r.kind.endsWith("_owned") ? "collection" : null);
});

test("no completion row reaches the corpus or the public corpus API, granted or not", () => {
  for (const grants of [[], [hash]]) {
    const state = mergeCorpus(undefined, [...catalog, ...progress], grants);
    expect(state.events).toEqual([]);
    expect(publicRecords(state, (r) => r)).toEqual([]);
  }
  for (const kind of COMPLETION_KINDS) expect(PUBLIC_RECORD_KINDS, kind).not.toContain(kind);
});

// --- the rollup: agreement, who may see owned rows, and its size ------------------------------------

type Upload = { records: unknown[]; grants?: string[]; reporter?: string; receivedAt?: string };
const fold = (uploads: Upload[], state = emptyCompletion()) =>
  foldCompletion(state, uploads.map((u) => ({ records: u.records, grants: u.grants ?? [], reporter: u.reporter, receivedAt: u.receivedAt })));

test("a catalog entry is listed only once 3 different installs reported it identically", () => {
  const entry = { kind: "title_catalog", titleId: 6, name: "Sergeant" };
  const two = fold([{ records: [row("reporter-one", entry), row("reporter-two", entry)] }]);
  expect(agreedCatalog(two).titles.size).toBe(0);
  // The same install three times, in three uploads, is still one install.
  const repeated = fold([1, 2, 3].map(() => ({ records: [row("reporter-one", entry)] })));
  expect(agreedCatalog(repeated).titles.size).toBe(0);
  const differ = fold([{ records: [row("reporter-one", entry), row("reporter-two", entry), row("reporter-three", { ...entry, name: "Sergeant Major" })] }]);
  expect(agreedCatalog(differ).titles.size).toBe(0);
  const agreed = fold([{ records: [row("reporter-one", entry), row("reporter-two", entry)] }, { records: [row("reporter-three", entry)] }]);
  expect([...agreedCatalog(agreed).titles.values()]).toEqual([{ titleId: 6, name: "Sergeant" }]);
});

test("one install cannot use up an entry's variants and keep the real one off the list", () => {
  const entry = { kind: "title_catalog", titleId: 6, name: "Sergeant" };
  const junk = ["A", "B", "C", "D"].map((name) => row("noisy-install", { ...entry, name }));
  const state = fold([{ records: junk }, { records: ["reporter-one", "reporter-two", "reporter-three"].map((id) => row(id, entry)) }]);
  expect(agreedCatalog(state).titles.get(6)?.name).toBe("Sergeant");
  expect(state.catalog.t["6"].length).toBeLessThanOrEqual(3);
});

test("owned progress is shown only for an install whose grant is live now", () => {
  const authority = (g: PublicationGrant) => ({ grants: [g], suppressions: [] });
  const state = fold([{ records: [...catalog, ...progress], grants: [hash] }]);
  const shown = (g: PublicationGrant) => completionFactsOf(state, authorizedOwners(state, authority(g), now)).owned.map((c) => c.installId);
  expect(shown(grant)).toEqual([OWNER]);
  expect(shown({ ...grant, installId: "other-install" })).toEqual([]);
  expect(shown({ ...grant, expiresAt: "2026-10-01T00:00:00Z" })).toEqual([]);
  expect(shown({ ...grant, revokedAt: "2026-10-14T00:00:00Z" })).toEqual([]);
  const ungranted = fold([{ records: [...catalog, ...progress] }]);
  expect(completionFactsOf(ungranted, authorizedOwners(ungranted, authority(grant), now)).owned).toEqual([]);
  // The catalogs need no grant.
  expect(completionFactsOf(ungranted, new Set()).achievements.size).toBe(3);
});

test("the rollup keeps the latest row per character and id: re-uploads do not grow it", () => {
  const upload = (n: number) => ({
    records: [
      ...catalog.map((r) => ({ ...r, eventId: `e:${++seq}`, capturedAt: at(n) })),
      owned({ kind: "achievement_owned", achievementId: 2, completed: false, criteriaMet: Math.min(9, n), criteriaTotal: 10 }, at(n)),
      owned({ kind: "reputation_owned", factionId: 69, reaction: 5, standing: 8000 + n, floor: 3000, ceiling: 9000 }, at(n)),
      owned({ kind: "title_owned", titleIds: [4] }, at(n)),
      owned({ kind: "quest_owned", questIds: [7, 8] }, at(n)),
    ],
  });
  const once = fold([upload(1)]);
  const many = fold(Array.from({ length: 9 }, (_, i) => upload(i + 1)));
  const size = (s: unknown) => JSON.stringify(s).length;
  expect(Math.abs(size(many) - size(once))).toBeLessThan(200);
  const [c] = completionFactsOf(many, "all").owned;
  expect(c.achievements.get(2)?.criteriaMet).toBe(9);
  expect(c.factions.get(69)?.standing).toBe(8009);
  expect([...c.quests]).toEqual([7, 8]);
  for (const variants of Object.values(many.catalog.a)) for (const v of variants) expect(v.v.length).toBeLessThanOrEqual(COMPLETION_LIMITS.sample);
});

test("the MCP tool reads the rollup, never the corpus, and says when it is not connected", async () => {
  expect(await answerCompletionProgress({ ownerInstallId: OWNER })).toBe(COMPLETION_UNSET);
  expect(await answerCompletionProgress({ ownerInstallId: OWNER }, async () => null)).toContain("unrecorded, not zero");
  expect(await answerCompletionProgress({ ownerInstallId: OWNER }, async () => { throw new Error("down"); })).toContain("unrecorded, not zero");
  // Two reporters are not enough: the lists stay unrecorded even though the progress is there.
  const twoReporters = [...catalog, ...progress].filter((r) => r.installId !== "reporter-three");
  const text = await answerCompletionProgress({ ownerInstallId: OWNER }, async () => ({ facts: completionFactsFromRecords(twoReporters), dataAsOf: null }));
  expect(text).toContain("Lists unrecorded");
  expect(text).not.toContain("Ten Quests");
  const asked: string[] = [];
  const full = await answerCompletionProgress({ ownerInstallId: ` ${OWNER} ` }, async (install) => { asked.push(install); return { facts: facts(), dataAsOf: "2026-10-19T06:30:00.000Z" }; });
  expect(asked).toEqual([OWNER]);
  expect(full).toContain("Ten Quests (Quests): 8 of 10 criteria");
  expect(full).toContain("Data as of 2026-10-19 06:30 UTC");
  // The install's own progress is there, so the answer links its page, last before the data age.
  expect(full).toContain(`More: https://everloot.app/tools/collections?install=${OWNER}\nData as of`);
  const structured = (await completionProgressAnswer({ ownerInstallId: OWNER, characterKey: KEY }, async () => ({ facts: facts(), dataAsOf: null }))).structured;
  expect(structured).toMatchObject({ connected: true, url: `https://everloot.app/tools/collections?install=${OWNER}&character=${KEY}` });
  // A key this install does not have: the page would say so and nothing else, so no link.
  expect((await completionProgressAnswer({ ownerInstallId: OWNER, characterKey: "ffffffff" }, async () => ({ facts: facts(), dataAsOf: null }))).structured).not.toHaveProperty("url");
});

// --- votes by address, support past 3, and junk that cannot block or freeze ----------------------------

const sergeant = { kind: "title_catalog", titleId: 6, name: "Sergeant" };
const vote = (install: string, reporter: string | undefined, fields: Record<string, unknown> = sergeant, receivedAt = at(5)): Upload =>
  ({ records: [row(install, fields)], reporter, receivedAt });

test("three installs behind one upload address are one voice; three addresses agree", () => {
  const oneAddress = fold(["a-install", "b-install", "c-install"].map((id) => vote(id, "0000000000000001")));
  expect(agreedCatalog(oneAddress).titles.size).toBe(0);
  const three = fold(["a-install", "b-install", "c-install"].map((id, i) => vote(id, `000000000000000${i + 1}`)));
  expect(agreedCatalog(three).titles.get(6)?.name).toBe("Sergeant");
});

test("the most supported content wins past 3, then the one confirmed first, not the first alphabetically", () => {
  const voters = (n: number, from: number) => Array.from({ length: n }, (_, i) => `voter-${String(from + i).padStart(4, "0")}`);
  const state = fold([
    ...voters(3, 0).map((id) => vote(id, undefined, { ...sergeant, name: "Aaa" })),
    ...voters(5, 10).map((id) => vote(id, undefined, { ...sergeant, name: "Zzz" })),
  ]);
  expect(agreedCatalog(state).titles.get(6)?.name).toBe("Zzz");
  const tie = fold([
    ...voters(3, 0).map((id) => vote(id, undefined, { ...sergeant, name: "Zzz" }, at(1))),
    ...voters(3, 10).map((id) => vote(id, undefined, { ...sergeant, name: "Aaa" }, at(4))),
  ]);
  // Same support: the content confirmed first stays, so a later wave cannot take over by being newer.
  expect(agreedCatalog(tie).titles.get(6)?.name).toBe("Zzz");
  // Supporters are counted past 3, up to the sample.
  const many = fold(voters(70, 100).map((id) => vote(id, undefined)));
  expect(many.catalog.t["6"][0].v).toHaveLength(COMPLETION_LIMITS.sample);
});

test("junk contents cannot hold an entry's slots: 10 real voters arriving after them are listed", () => {
  const junk = ["J1", "J2", "J3"].map((name, i) => vote(`junk-${i}-install`, `00000000000000a${i}`, { ...sergeant, name }, at(1)));
  const real = Array.from({ length: 10 }, (_, i) => vote(`real-${i}-install`, `00000000000001${String(i).padStart(2, "0")}`, sergeant, at(2)));
  const state = fold([...junk, ...real]);
  expect(agreedCatalog(state).titles.get(6)?.name).toBe("Sergeant");
  // More junk later evicts the least supported content, never the listed one.
  fold(["J4", "J5", "J6"].map((name, i) => vote(`junk-${i + 3}-install`, `00000000000000b${i}`, { ...sergeant, name }, at(3))), state);
  expect(agreedCatalog(state).titles.get(6)?.name).toBe("Sergeant");
  expect(state.catalog.t["6"].length).toBeLessThanOrEqual(COMPLETION_LIMITS.variantsPerId);
});

test("one address flooding junk ids is capped, and the rollup stays small", () => {
  const flood = (n: number): Upload => ({
    reporter: "00000000000000ff", receivedAt: at(5),
    records: Array.from({ length: 2000 }, (_, i) => row(`fake-${n}-install`, {
      kind: "achievement_catalog", achievementId: 100000 + n * 2000 + i, name: `Junk ${n} ${i} ${"x".repeat(100)}`, categoryId: 1,
      category: "Junk", points: 10, criteriaCount: 20, criteria: Array.from({ length: 20 }, (_, c) => ({ text: "y".repeat(120), required: c })),
    })),
  });
  // 10 uploads of 2000 new ids from one address: five times what one voter may hold unconfirmed.
  const state = fold(Array.from({ length: 10 }, (_, n) => flood(n)));
  expect(Object.keys(state.catalog.a).length).toBeLessThanOrEqual(COMPLETION_LIMITS.createdPerVoter);
  // Criteria lists are a separate vote with their own per-voter cap, so they add at most that much.
  const criteriaBytes = Object.values(state.catalog.c ?? {}).flat().reduce((n, v) => n + v.c.length, 0);
  expect(criteriaBytes).toBeLessThanOrEqual(COMPLETION_LIMITS.createdBytesPerVoter);
  expect(JSON.stringify(state).length).toBeLessThan(2_000_000 + 2 * COMPLETION_LIMITS.createdBytesPerVoter);
  // A real entry from three other addresses still gets in and is listed.
  fold(["r1", "r2", "r3"].map((id, i) => vote(`${id}-install`, `000000000000010${i}`)), state);
  expect(agreedCatalog(state).titles.get(6)?.name).toBe("Sergeant");
}, 30_000);

test("near its size limit the rollup trims unconfirmed contents, then ungranted progress, and never refuses", () => {
  const state = fold([
    ...["r1", "r2", "r3"].map((id, i) => vote(`${id}-install`, `000000000000020${i}`)),
    { records: [...catalog, ...progress], grants: [hash], receivedAt: at(3) },
    { records: [owned({ kind: "quest_owned", questIds: Array.from({ length: 200 }, (_, i) => i + 1) }, at(1), "eeeeeeee")].map((r) => ({ ...r, installId: "stale-install" })), receivedAt: at(1) },
    ...Array.from({ length: 40 }, (_, n): Upload => ({
      reporter: `0000000000003${String(n).padStart(3, "0")}`, receivedAt: at(1),
      records: Array.from({ length: 50 }, (_, i) => row(`junk-${n}-install`, { kind: "title_catalog", titleId: 1000 + n * 50 + i, name: `Junk title ${n} ${i}` })),
    })),
  ]);
  const size = JSON.stringify(state).length;
  // First the contents nobody confirmed: all characters stay.
  const first = trimCompletion(state, Math.floor(size / 2), new Set([OWNER]));
  expect(first.size).toBeLessThanOrEqual(size / 2 * 0.9);
  expect(first).toMatchObject({ characters: 0 });
  expect(first.variants).toBeGreaterThan(0);
  expect(agreedCatalog(state).titles.get(6)?.name).toBe("Sergeant");
  expect(Object.keys(state.owned["stale-install"].characters)).toEqual(["eeeeeeee"]);
  // With nothing unconfirmed left to drop, progress of installs without a live grant goes before the granted owner's.
  const stale = ["e0000001", "e0000002", "e0000003", "e0000004"].map((key, i) =>
    ({ ...owned({ kind: "quest_owned", questIds: Array.from({ length: 200 }, (_, q) => q + 1) }, at(i + 1), key), installId: "stale-install" }));
  const lean = fold([
    ...["r1", "r2", "r3"].map((id, i) => vote(`${id}-install`, `000000000000020${i}`)),
    { records: [...catalog, ...progress], grants: [hash], receivedAt: at(3) },
    { records: stale, receivedAt: at(5) },
  ]);
  const second = trimCompletion(lean, Math.floor(JSON.stringify(lean).length * 0.7), new Set([OWNER]));
  expect(second).toMatchObject({ variants: 0 });
  expect(second.characters).toBeGreaterThan(0);
  expect(lean.owned["stale-install"].dropped).toBe(second.characters);
  expect(Object.keys(lean.owned[OWNER].characters)).toEqual([KEY]);
  expect(agreedCatalog(lean).titles.get(6)?.name).toBe("Sergeant");
  // Under the threshold nothing is dropped.
  expect(trimCompletion(state, 100_000_000, null)).toMatchObject({ variants: 0, characters: 0 });
});

// --- characters, grants, capture time, and reading one install ------------------------------------------

test("a ninth character replaces the one seen longest ago, and the answer says characters were dropped", () => {
  const keys = Array.from({ length: 9 }, (_, i) => `0000000${i}`);
  const state = fold(keys.map((key, i) => ({ records: [owned({ kind: "title_owned", titleIds: [4] }, at(i + 1), key)], grants: [hash], receivedAt: at(20) })));
  expect(Object.keys(state.owned[OWNER].characters).sort()).toEqual(keys.slice(1));
  const facts = completionFactsOf(state, "all", OWNER);
  const p = completionProgress(OWNER, undefined, facts);
  expect(p.droppedCharacters).toBe(1);
  expect(handleCompletionProgress({ ownerInstallId: OWNER }, facts)).toContain("1 older character is no longer kept");
});

test("grants are kept in upload order, the newest 8", () => {
  const grants = Array.from({ length: 10 }, (_, i) => String(i).repeat(64).slice(0, 64));
  const state = fold(grants.map((g, i) => ({ records: [owned({ kind: "title_owned", titleIds: [4] }, at(i + 1))], grants: [g] })));
  expect(state.owned[OWNER].grants).toEqual(grants.slice(2));
  // The grant used most recently stays even if it sorts first.
  fold([{ records: [owned({ kind: "title_owned", titleIds: [5] }, at(15))], grants: [grants[2]] }], state);
  expect(state.owned[OWNER].grants.at(-1)).toBe(grants[2]);
});

test("a capture time later than the upload's arrival is clamped, so a future clock cannot pin a row", () => {
  const future = owned({ kind: "reputation_owned", factionId: 69, reaction: 5, standing: 9999, floor: 3000, ceiling: 9000 }, "2099-01-01T00:00:00Z");
  const state = fold([{ records: [future], receivedAt: at(2) }]);
  expect(state.owned[OWNER].characters[KEY].at).toBe(new Date(at(2)).toISOString());
  fold([{ records: [owned({ kind: "reputation_owned", factionId: 69, reaction: 5, standing: 8600, floor: 3000, ceiling: 9000 }, at(3))], receivedAt: at(3) }], state);
  expect(completionFactsOf(state, "all").owned[0].factions.get(69)?.standing).toBe(8600);
});

test("a page asking about one install checks and builds only that install", () => {
  const other = progress.map((r) => ({ ...r, installId: "other-install", eventId: `o:${++seq}` }));
  const state = fold([{ records: [...catalog, ...progress, ...other], grants: [hash] }]);
  const authority = { grants: [grant, { ...grant, installId: "other-install" }], suppressions: [] };
  expect([...authorizedOwners(state, authority, now, OWNER)]).toEqual([OWNER]);
  expect([...authorizedOwners(state, authority, now, "missing-install")]).toEqual([]);
  expect(completionFactsOf(state, "all", OWNER).owned.map((c) => c.installId)).toEqual([OWNER]);
});

test("an achievement's criteria list is shown only when three reporters sent the same complete list", () => {
  const base = { kind: "achievement_catalog", name: "Explore Elwynn", categoryId: 10, category: "Exploration", points: 10, criteriaCount: 2 };
  const list = [{ text: "Goldshire", required: 1 }, { text: "Northshire Abbey", required: 1 }];
  const facts = completionFactsFromRecords([
    ...three({ ...base, achievementId: 40, criteria: list }),
    // Two complete lists and a third that differs: the entry is listed, its criteria are not.
    ...three({ ...base, achievementId: 41, criteria: list }).map((r, i) => (i === 2 ? { ...r, criteria: [list[0], { text: "Fargodeep Mine", required: 1 }] } : r)),
    // A cut-off list (one of two) or a blank criterion is never voted on.
    ...three({ ...base, achievementId: 42, criteria: [list[0]] }),
    ...three({ ...base, achievementId: 43, criteria: [list[0], { text: " ", required: 1 }] }),
  ]);
  expect(facts.achievements.get(40)?.criteria).toEqual(list);
  for (const id of [41, 42, 43]) {
    expect(facts.achievements.get(id)?.name).toBe("Explore Elwynn");
    expect(facts.achievements.get(id)?.criteria).toBeUndefined();
  }
});

test("criteria agreed without an agreed entry show nowhere, and a rollup written before criteria still folds", () => {
  const state = emptyCompletion();
  delete state.catalog.c;
  const list = [{ text: "Goldshire", required: 1 }];
  foldCompletion(state, [{ grants: [], records: ["a", "b", "c"].map((id, i) => row(`split-reporter-${id}`, { kind: "achievement_catalog", achievementId: 50, name: `Name ${i}`, categoryId: 1, category: "General", points: 5, criteriaCount: 1, criteria: list })) }]);
  expect(Object.keys(state.catalog.c ?? {})).toEqual(["50"]);
  expect(agreedCatalog(state).achievements.has(50)).toBe(false);
});
