import { describe, expect, test } from "vitest";
import { encodeBuild } from "./talents/share";
import {
  NEWEST_VERSION, WORKSPACE_LIMITS, WORKSPACE_VERSION, applyImport, bindTransferred, bucketKey, copyPlan, deletePlan, editPlan,
  emptyWorkspace, exportBackup, lookupOwner, orderState, previewImport, readPlanText, readWorkspace, savePlan, validateWorkspace,
  type LocalAlt, type LocalPlan, type Owner, type PlanInput, type PlayerWorkspace,
} from "./player-workspace";
import { FIXTURE_PLAN_ID, V2_ALT_TEXT, V2_BUCKET_TEXT, V3_BUCKET_TEXT } from "./player-workspace.fixture";
import { storedForm, update, transferRoom, transferKey, settleTransferred, receiptSaved, receiptFailed, rememberCharacter, characterRefused } from "./player-workspace";
import { deleteAlt, saveAlt } from "./alt-workspace";
import { applyAltImport, previewAltImport } from "./alt-import";

// Codes and tokens from docs/2026-10-17-talent-share-code.md: MAGE is 90001:2, 90002:1:1, 90004:2, so its
// nodes index as A, B and C, and O1p-AABCC is a player's order for its five points.
const MAGE = "EL1-mage-1482-1.60.1.70450-OTAwMDE6Miw5MDAwMjoxOjEsOTAwMDQ6Mg";
const MAGE_SMALL = "EL1-mage-1482-1.60.1.70450-OTAwMDE6MQ"; // 90001:1
const DRUID = "EL1-druid-0-1.60.1.70450-OTAwMDE6MQ";
const PLANNED = "O1p-AABCC";

const ANON: Owner = { kind: "anonymous" };
const A_ID = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";
const B_ID = "7c1d2e3f-4a5b-4c6d-8e7f-901a2b3c4d5e";
const A: Owner = { kind: "account", userId: A_ID };
const B: Owner = { kind: "account", userId: B_ID };
const NOW = new Date("2026-10-26T12:00:00.000Z");
const LATER = new Date("2026-10-27T12:00:00.000Z");

/** localStorage as a map. `fail` makes every write throw as a full or a denied storage does. */
function memory(fail: "full" | "denied" | null = null) {
  const items = new Map<string, string>();
  const error = () => new DOMException(fail === "full" ? "The quota has been exceeded." : "Access is denied.", fail === "full" ? "QuotaExceededError" : "SecurityError");
  return {
    items,
    getItem: (key: string) => { if (fail === "denied") throw error(); return items.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (fail) throw error(); items.set(key, value); },
    removeItem: (key: string) => { if (fail === "denied") throw error(); items.delete(key); },
  };
}

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  name: "Frost leveling", notes: "", classSlug: "mage", codes: [MAGE, null], orders: [PLANNED, null], ...over,
});

function saved(storage: ReturnType<typeof memory>, owner: Owner, over: Partial<PlanInput> = {}, now = NOW): LocalPlan {
  const result = savePlan(storage, owner, input(over), now);
  if (!result.ok) throw new Error(`save failed: ${result.error}`);
  return result.plan;
}

const names = (storage: ReturnType<typeof memory>, owner: Owner) => {
  const read = readWorkspace(storage, owner);
  if (!read.ok) throw new Error(`read failed: ${read.error}`);
  return read.workspace.plans.map((p) => p.name).sort();
};

/** A stored plan, written by hand as the format spells it. */
const plan = (over: Partial<LocalPlan> = {}): LocalPlan => ({
  id: "1a2b3c4d-0000-4000-8000-000000000001", name: "Frost", classSlug: "mage", code: MAGE, code2: null, order: null, order2: null,
  notes: "", updatedAt: "2026-10-20T12:00:00.000Z", boundTo: null, ...over,
});
const workspace = (owner: Owner, plans: LocalPlan[], over: Partial<PlayerWorkspace> = {}): PlayerWorkspace => ({
  format: "everloot.player-workspace", version: 2, owner, plans, alts: [], watches: [], ...over,
});
/** A stored alt in the version 2 format, written by hand. */
const altOf = (over: Partial<LocalAlt> = {}): LocalAlt => ({
  id: "1a2b3c4d-0000-4000-8000-000000000500", name: "Thrall", realm: null, classSlug: null, faction: null, level: null,
  professions: [], notes: "", planIds: [], provenance: { source: "manual", fileRecordAt: null, fileDetails: [] },
  updatedAt: "2026-10-20T12:00:00.000Z", ...over,
});
/** A bucket as version 1 wrote it: its alts had a name, plans and notes only. */
const versionOne = (owner: Owner, plans: LocalPlan[], alts: object[] = [], watches: object[] = []) =>
  ({ format: "everloot.player-workspace", version: 1, owner, plans, alts, watches });
const idOf = (n: number) => `1a2b3c4d-0000-4000-8000-${String(n).padStart(12, "0")}`;
const bytes = (text: string) => new TextEncoder().encode(text).length;

describe("v3 reader-only compatibility", () => {
  const v3 = () => JSON.parse(V3_BUCKET_TEXT) as PlayerWorkspace;
  test("reads and exports all three watch variants without rewriting bytes or downstamping", () => {
    const storage = memory();
    storage.items.set(bucketKey(ANON), V3_BUCKET_TEXT);
    storage.setItem = () => { throw new Error("Read must not write"); };
    storage.removeItem = () => { throw new Error("Read must not erase"); };
    expect(readWorkspace(storage, ANON)).toMatchObject({ ok: true, raw: V3_BUCKET_TEXT, workspace: v3() });
    expect(storedForm(v3())).toEqual(v3());
    const backup = exportBackup(v3(), NOW);
    expect(backup.ok && JSON.parse(backup.text)).toEqual(v3());
    expect(storage.items.get(bucketKey(ANON))).toBe(V3_BUCKET_TEXT);
    expect(emptyWorkspace(ANON).version).toBe(2);
  });
  test("exports guides while omitting hidden plans, their watches and alt references", () => {
    const result = exportBackup(v3(), NOW, new Set([FIXTURE_PLAN_ID]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const doc = JSON.parse(result.text);
    expect(doc.watches).toEqual(v3().watches.slice(1));
    expect(doc.alts[0].planIds).toEqual([]);
    expect(validateWorkspace(doc).ok).toBe(true);
  });
  test("strict variants, references, UUID and target uniqueness; v2 rejects typed keys", () => {
    expect(validateWorkspace(v3()).ok).toBe(true);
    const change = (mutate: (doc: { version: number; watches: Record<string, unknown>[] }) => void) => {
      const doc = JSON.parse(V3_BUCKET_TEXT);
      mutate(doc);
      expect(validateWorkspace(doc).ok).toBe(false);
    };
    for (const bad of [0, -1, 1.5, "7", null]) change((d) => { d.watches[2].guideId = bad; });
    for (const bad of [0, -1, 1.5, "2"]) change((d) => { d.watches[2].seenVersion = bad; });
    for (const bad of ["", "1", "1..2", "a.2", 123]) change((d) => { d.watches[1].seenBuild = bad; });
    for (const key of ["notes", "name", "snapshot", "visitedAt", "planId"]) change((d) => { d.watches[2][key] = "extra"; });
    change((d) => { delete d.watches[2].seenVersion; });
    change((d) => { d.watches[1].planId = idOf(999); });
    change((d) => { d.watches[1].planId = FIXTURE_PLAN_ID; });
    change((d) => { d.watches[1].id = d.watches[0].id; });
    change((d) => { d.watches.push({ ...d.watches[2], id: idOf(799) }); });
    change((d) => { d.version = 2; });
    change((d) => { d.watches[0].seenBuild = null; });
    change((d) => { d.watches[1].seenVersion = null; });
    change((d) => { d.watches[2].kind = "unknown"; });
    const unknown = v3(); unknown.watches = [unknown.watches[1], unknown.watches[2]];
    Object.assign(unknown.watches[0], { seenBuild: null });
    Object.assign(unknown.watches[1], { seenVersion: 2 });
    expect(validateWorkspace(unknown).ok).toBe(true);
  });
  test("v3 retains whole-document UTF-8, collection, field and reference limits", () => {
    const capped = v3();
    capped.plans = Array.from({ length: 200 }, (_, i) => plan({ id: idOf(i + 1), name: "x".repeat(60), notes: "😀".repeat(1000) }));
    capped.alts = Array.from({ length: 60 }, (_, i) => altOf({ id: idOf(i + 500), notes: "😀".repeat(1000) }));
    capped.watches = [];
    expect(bytes(JSON.stringify(capped))).toBeGreaterThan(WORKSPACE_LIMITS.bytes);
    expect(validateWorkspace(capped)).toMatchObject({ ok: false, error: "over-limit" });
    capped.plans = capped.plans.map((p) => ({ ...p, notes: "" }));
    expect(validateWorkspace(capped).ok).toBe(true);
    expect(validateWorkspace({ ...capped, plans: [...capped.plans, plan({ id: idOf(400) })] })).toMatchObject({ ok: false, error: "over-limit" });
    expect(validateWorkspace({ ...capped, alts: [...capped.alts, altOf({ id: idOf(900) })] })).toMatchObject({ ok: false, error: "over-limit" });
    capped.alts[0].planIds = capped.plans.slice(0, 11).map((p) => p.id);
    expect(validateWorkspace(capped)).toMatchObject({ ok: false, error: "over-limit" });
    capped.alts[0].planIds.pop();
    expect(validateWorkspace(capped).ok).toBe(true);
    capped.alts[0].realm = "x".repeat(61);
    expect(validateWorkspace(capped).ok).toBe(false);
  });
  test("every local mutator and restore refuses before writing, including a legacy restore into v3", () => {
    const storage = memory();
    storage.items.set(bucketKey(ANON), V3_BUCKET_TEXT);
    let called = false;
    for (const result of [
      update(storage, ANON, (w) => { called = true; return w; }),
      savePlan(storage, ANON, input()), editPlan(storage, ANON, FIXTURE_PLAN_ID, { name: "Changed", notes: "" }),
      copyPlan(storage, ANON, FIXTURE_PLAN_ID), deletePlan(storage, ANON, FIXTURE_PLAN_ID),
      applyImport(storage, ANON, { base: JSON.stringify(v3()), result: workspace(ANON, []), added: 0, updated: 0, kept: 0, unchanged: 0, others: 0, warnings: [] }),
    ]) expect(result).toMatchObject({ ok: false, error: "read-only" });
    expect(called).toBe(false);
    expect(previewImport(V3_BUCKET_TEXT, emptyWorkspace(ANON))).toMatchObject({ ok: false, error: "read-only" });
    expect(previewImport(V2_BUCKET_TEXT, v3())).toMatchObject({ ok: false, error: "read-only" });
    const legacy = previewImport(V2_BUCKET_TEXT, emptyWorkspace(ANON));
    expect(legacy.ok).toBe(true);
    if (legacy.ok) expect(applyImport(storage, ANON, legacy.preview).ok).toBe(false);
    expect(storage.items.get(bucketKey(ANON))).toBe(V3_BUCKET_TEXT);
    const empty = memory();
    expect(update(empty, ANON, () => v3())).toMatchObject({ ok: false, error: "read-only" });
    expect(applyImport(empty, ANON, { base: JSON.stringify(emptyWorkspace(ANON)), result: v3(), added: 0, updated: 0, kept: 0, unchanged: 0, others: 0, warnings: [] })).toMatchObject({ ok: false, error: "read-only" });
    expect(empty.items.size).toBe(0);
  });
  test("alt saves, deletion and addon-file apply reach the central v3 refusal", () => {
    const storage = memory();
    storage.items.set(bucketKey(ANON), V3_BUCKET_TEXT);
    const preview = previewAltImport({ ok: true, characters: [{ name: "Jaina", realm: "Moon Guard", classSlug: "mage", faction: "alliance", level: 24, recordAt: NOW.toISOString() }], skipped: { noRealm: 0, unreadable: 0 }, others: 0 }, v3());
    for (const result of [
      saveAlt(storage, ANON, { name: "Jaina", realm: "", classSlug: null, faction: null, level: null, professions: [], notes: "", planIds: [] }),
      deleteAlt(storage, ANON, v3().alts[0].id), applyAltImport(storage, ANON, preview, ["add"]),
    ]) expect(result).toMatchObject({ ok: false, error: "read-only" });
    expect(storage.items.get(bucketKey(ANON))).toBe(V3_BUCKET_TEXT);
  });
  test.each(["source", "destination"])("v3 %s refuses transfers before registry access or movement", (side) => {
    const storage = memory();
    const source = side === "source" ? v3() : workspace(ANON, [plan()]);
    const target = { ...(side === "destination" ? v3() : emptyWorkspace(A)), owner: A };
    storage.items.set(bucketKey(ANON), JSON.stringify(source));
    storage.items.set(bucketKey(A), JSON.stringify(target));
    const before = [...storage.items];
    const getItem = storage.getItem;
    storage.getItem = (key) => { if (key === "everloot:transfers") throw new Error("Registry must not be read"); return getItem(key); };
    const label = { name: "Jaina", classSlug: "mage", realm: null, note: null };
    for (const result of [
      transferRoom(source, target, [FIXTURE_PLAN_ID]), transferKey(storage, A, FIXTURE_PLAN_ID),
      bindTransferred(storage, { owner: A, planIds: [FIXTURE_PLAN_ID] }, { ok: true, userId: A_ID, planIds: [FIXTURE_PLAN_ID] }),
      settleTransferred(storage, A, [FIXTURE_PLAN_ID]),
      receiptSaved(storage, A, FIXTURE_PLAN_ID, "a".repeat(16), "content"),
      receiptFailed(storage, A, FIXTURE_PLAN_ID, "a".repeat(16), "failed"),
      rememberCharacter(storage, A, idOf(500), label, null), characterRefused(storage, A, idOf(500), NOW.toISOString()),
    ]) expect(result).toMatchObject({ ok: false, error: "read-only" });
    expect([...storage.items]).toEqual(before);
  });
});

describe("buckets", () => {
  test("an empty device reads as an empty workspace for every owner, and reading writes nothing", () => {
    const storage = memory();
    for (const owner of [ANON, A]) {
      const read = readWorkspace(storage, owner);
      expect(read).toEqual({ ok: true, workspace: emptyWorkspace(owner), raw: null });
    }
    expect(storage.items.size).toBe(0);
  });

  test("a plan saved signed out stays in the signed-out bucket: no account sees it", () => {
    const storage = memory();
    saved(storage, ANON);
    expect(names(storage, ANON)).toEqual(["Frost leveling"]);
    expect(names(storage, A)).toEqual([]);
    expect(names(storage, B)).toEqual([]);
  });

  test("a plan saved under one account is hidden from another account and from the signed-out view", () => {
    const storage = memory();
    saved(storage, A, { name: "A's plan" });
    saved(storage, B, { name: "B's plan" });
    expect(names(storage, A)).toEqual(["A's plan"]);
    expect(names(storage, B)).toEqual(["B's plan"]);
    expect(names(storage, ANON)).toEqual([]);
  });

  test("an account's bucket is named by its stable id, and nothing else is stored under the account", () => {
    expect(bucketKey(ANON)).toBe("everloot:workspace:anonymous");
    expect(bucketKey(A)).toBe(`everloot:workspace:account:${A_ID}`);
    const storage = memory();
    saved(storage, A);
    expect([...storage.items.keys()]).toEqual([`everloot:workspace:account:${A_ID}`]);
  });

  test("the gold ledger, the collections character and Chat's entries are left as they are", () => {
    const storage = memory();
    const others = { "everloot:gold-ledger": "{\"madeAt\":\"x\"}", "everloot.completion.character.v1": "{\"name\":\"Thrall\"}", "everloot.chat.conversations.v1": "[]" };
    for (const [key, value] of Object.entries(others)) storage.items.set(key, value);
    const one = saved(storage, ANON);
    editPlan(storage, ANON, one.id, { name: "Renamed", notes: "" }, LATER);
    copyPlan(storage, ANON, one.id, LATER);
    deletePlan(storage, ANON, one.id);
    for (const [key, value] of Object.entries(others)) expect(storage.items.get(key)).toBe(value);
    expect([...storage.items.keys()].filter((k) => !(k in others))).toEqual([bucketKey(ANON)]);
  });

  test("two tabs saving in turn keep both plans: each save reads what is stored first", () => {
    const storage = memory();
    saved(storage, ANON, { name: "From tab one" });
    saved(storage, ANON, { name: "From tab two" });
    expect(names(storage, ANON)).toEqual(["From tab one", "From tab two"]);
  });

  test("a stored bucket that names another owner than its key is refused, not shown", () => {
    const storage = memory();
    storage.items.set(bucketKey(ANON), JSON.stringify(workspace(A, [plan()])));
    expect(readWorkspace(storage, ANON)).toMatchObject({ ok: false, error: "corrupt" });
  });

  test("a signed-out bucket holding a plan bound to an account is refused, so a bound plan never shows signed out", () => {
    const storage = memory();
    storage.items.set(bucketKey(ANON), JSON.stringify(workspace(ANON, [plan({ boundTo: { userId: A_ID, at: "2026-10-21T00:00:00.000Z" } })])));
    expect(readWorkspace(storage, ANON)).toMatchObject({ ok: false, error: "corrupt" });
    storage.items.set(bucketKey(B), JSON.stringify(workspace(B, [plan({ boundTo: { userId: A_ID, at: "2026-10-21T00:00:00.000Z" } })])));
    expect(readWorkspace(storage, B)).toMatchObject({ ok: false, error: "corrupt" });
  });
});

describe("storage that fails", () => {
  test("denied storage reads as unavailable and a save reports it, with nothing saved", () => {
    const storage = memory("denied");
    expect(readWorkspace(storage, ANON)).toMatchObject({ ok: false, error: "unavailable" });
    expect(readWorkspace(null, ANON)).toMatchObject({ ok: false, error: "unavailable" });
    expect(savePlan(storage, ANON, input(), NOW)).toMatchObject({ ok: false, error: "unavailable" });
    expect(savePlan(null, ANON, input(), NOW)).toMatchObject({ ok: false, error: "unavailable" });
  });

  test("a full storage refuses the save and keeps what was stored", () => {
    const storage = memory();
    saved(storage, ANON, { name: "Kept" });
    const before = storage.items.get(bucketKey(ANON));
    const full = { ...storage, setItem: () => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); } };
    expect(savePlan(full, ANON, input({ name: "New" }), NOW)).toMatchObject({ ok: false, error: "full" });
    expect(storage.items.get(bucketKey(ANON))).toBe(before);
  });

  test("corrupt stored plans are kept as they are: reads say so and no save writes over them", () => {
    const storage = memory();
    storage.items.set(bucketKey(ANON), "{not json");
    expect(readWorkspace(storage, ANON)).toMatchObject({ ok: false, error: "corrupt", raw: "{not json" });
    expect(savePlan(storage, ANON, input(), NOW)).toMatchObject({ ok: false, error: "corrupt" });
    expect(storage.items.get(bucketKey(ANON))).toBe("{not json");
  });

  test("plans saved by a newer version are never overwritten", () => {
    const storage = memory();
    const newer = JSON.stringify({ format: "everloot.player-workspace", version: NEWEST_VERSION + 1, owner: ANON, shelves: [] });
    storage.items.set(bucketKey(ANON), newer);
    expect(readWorkspace(storage, ANON)).toMatchObject({ ok: false, error: "newer-version", raw: newer });
    expect(savePlan(storage, ANON, input(), NOW)).toMatchObject({ ok: false, error: "newer-version" });
    expect(deletePlan(storage, ANON, idOf(1))).toMatchObject({ ok: false, error: "newer-version" });
    expect(storage.items.get(bucketKey(ANON))).toBe(newer);
  });
});

describe("version 2, as the alt planner writes it, is kept", () => {
  /** The bucket's stored alts, as text. */
  const altsText = (text: string) => /"alts":(\[.*\]),"watches"/.exec(text)?.[1];

  test("a plan edit on a version 2 bucket keeps it version 2, with every alt field kept byte for byte", () => {
    const storage = memory();
    storage.items.set(bucketKey(ANON), V2_BUCKET_TEXT);
    const read = readWorkspace(storage, ANON);
    expect(read).toMatchObject({ ok: true, workspace: { version: 2 } });
    expect(editPlan(storage, ANON, FIXTURE_PLAN_ID, { name: "Frost raid", notes: "Raid" }, LATER)).toMatchObject({ ok: true });
    const text = storage.items.get(bucketKey(ANON))!;
    expect(JSON.parse(text)).toMatchObject({ version: 2, plans: [{ id: FIXTURE_PLAN_ID, name: "Frost raid", notes: "Raid" }] });
    expect(altsText(text)).toBe(`[${V2_ALT_TEXT}]`);
    // So does every other change: a new plan, a copy, a delete.
    const extra = saved(storage, ANON, { name: "Second" });
    copyPlan(storage, ANON, extra.id, LATER);
    deletePlan(storage, ANON, extra.id);
    expect(altsText(storage.items.get(bucketKey(ANON))!)).toBe(`[${V2_ALT_TEXT}]`);
  });

  test("a version 2 alt still guards the plans it uses", () => {
    const storage = memory();
    storage.items.set(bucketKey(ANON), V2_BUCKET_TEXT);
    expect(deletePlan(storage, ANON, FIXTURE_PLAN_ID)).toMatchObject({ ok: false, error: "referenced" });
    expect(storage.items.get(bucketKey(ANON))).toBe(V2_BUCKET_TEXT);
  });

  test("a version 2 backup restores into a signed-out device that has no alts, which becomes version 2 with the alts as they were", () => {
    const storage = memory();
    saved(storage, ANON, { name: "Here" });
    const read = readWorkspace(storage, ANON);
    const preview = read.ok ? previewImport(V2_BUCKET_TEXT, read.workspace) : null;
    if (!preview?.ok) throw new Error("no preview");
    expect(preview.preview).toMatchObject({ added: 1, others: 1, result: { version: 2 } });
    expect(applyImport(storage, ANON, preview.preview)).toMatchObject({ ok: true });
    const text = storage.items.get(bucketKey(ANON))!;
    expect(JSON.parse(text).version).toBe(2);
    expect(altsText(text)).toBe(`[${V2_ALT_TEXT}]`);
    expect(names(storage, ANON)).toEqual(["Frost", "Here"]);
  });

  test("a backup of a version 2 bucket is its own text, and restoring it again changes nothing", () => {
    const storage = memory();
    storage.items.set(bucketKey(ANON), V2_BUCKET_TEXT);
    const read = readWorkspace(storage, ANON);
    const backup = read.ok ? exportBackup(read.workspace, NOW) : null;
    expect(backup).toMatchObject({ ok: true, text: V2_BUCKET_TEXT });
    const again = read.ok ? previewImport(V2_BUCKET_TEXT, read.workspace) : null;
    expect(again).toMatchObject({ ok: true, preview: { added: 0, updated: 0, unchanged: 1, others: 0 } });
  });
});

describe("format version 2: alts with their details, and version 1 still read", () => {
  const oldAlt = { id: idOf(500), name: "Thrall", planIds: [idOf(1)], notes: "Bank alt", updatedAt: "2026-10-20T12:00:00.000Z" };
  const watch = { id: idOf(700), planId: idOf(1), addedAt: "2026-10-20T12:00:00.000Z" };
  /** oldAlt as version 2 reads it: what it had, and nothing known about the rest. */
  const upgraded = altOf({ id: idOf(500), name: "Thrall", planIds: [idOf(1)], notes: "Bank alt" });
  const one = () => plan({ id: idOf(1) });

  test("a new bucket is stored as version 2", () => {
    const storage = memory();
    saved(storage, ANON);
    expect(WORKSPACE_VERSION).toBe(2);
    expect(JSON.parse(storage.items.get(bucketKey(ANON))!).version).toBe(2);
  });

  test("a version 1 bucket reads with its alts' version 2 details unknown, stays version 1, and reading writes nothing", () => {
    const storage = memory();
    const text = JSON.stringify(versionOne(ANON, [one()], [oldAlt], [watch]));
    storage.items.set(bucketKey(ANON), text);
    const read = readWorkspace(storage, ANON);
    expect(read).toMatchObject({ ok: true, raw: text });
    expect(read.ok && read.workspace).toEqual(workspace(ANON, [one()], { version: 1, alts: [upgraded], watches: [watch] }));
    expect(storage.items.get(bucketKey(ANON))).toBe(text);
  });

  test("a change to a version 1 bucket stores version 1, alts and all, while no alt holds a version 2 detail", () => {
    const storage = memory();
    storage.items.set(bucketKey(ANON), JSON.stringify(versionOne(ANON, [one()], [oldAlt], [watch])));
    const added = saved(storage, ANON, { name: "New" });
    expect(storage.items.get(bucketKey(ANON))).toBe(JSON.stringify(versionOne(ANON, [one(), added], [oldAlt], [watch])));
  });

  const letters = (n: number) => "\u{1D538}".repeat(n);
  /** A version 1 bucket's alts and plans, names and notes at their longest, with as many plans as 1 MiB holds. */
  function nearFull() {
    const alts = Array.from({ length: 60 }, (_, i) => ({ ...oldAlt, id: idOf(500 + i), name: letters(60), planIds: [], notes: letters(1000) }));
    const plans: LocalPlan[] = [];
    for (let i = 0; ; i++) {
      const next = plan({ id: idOf(i), name: `Plan ${i}`, notes: letters(1000) });
      if (bytes(JSON.stringify(versionOne(ANON, [...plans, next], alts))) > WORKSPACE_LIMITS.bytes) break;
      plans.push(next);
    }
    return { plans, alts };
  }

  test("a version 1 bucket near 1 MiB keeps working: its backup is its own stored text, and a plan change is stored as version 1", () => {
    const { plans, alts } = nearFull();
    const storage = memory();
    const text = JSON.stringify(versionOne(ANON, plans, alts));
    storage.items.set(bucketKey(ANON), text);
    const read = readWorkspace(storage, ANON);
    if (!read.ok) throw new Error(read.error);
    // Spelled out in version 2, the same alts would take more than a device keeps.
    expect(bytes(JSON.stringify({ ...read.workspace, version: 2 }))).toBeGreaterThan(WORKSPACE_LIMITS.bytes);
    expect(exportBackup(read.workspace, NOW)).toMatchObject({ ok: true, text });
    expect(editPlan(storage, ANON, idOf(0), { name: "P", notes: "" }, LATER)).toMatchObject({ ok: true });
    const after = JSON.parse(storage.items.get(bucketKey(ANON))!);
    expect([after.version, after.plans[0].name, after.alts[0]]).toEqual([1, "P", alts[0]]);
  });

  test("a version 1 bucket near the limit stays exportable after it is read (reported case)", () => {
    const code = plan().code;
    const plans = Array.from({ length: 200 }, (_, i) => plan({ id: idOf(i + 1), name: `Plan ${i + 1}`, code2: code, order: `O9p-${"A".repeat(396)}`, order2: `O9p-${"A".repeat(396)}` }));
    const alts = Array.from({ length: 60 }, (_, i) => ({ id: idOf(500 + i), name: `Alt ${i}`, planIds: [], notes: "", updatedAt: "2026-10-20T12:00:00.000Z" }));
    const v1 = { ...emptyWorkspace(ANON), version: 1, plans, alts };
    for (const entry of [...plans, ...alts]) {
      const room = WORKSPACE_LIMITS.bytes - bytes(JSON.stringify(v1));
      if (room > 0) entry.notes = "\u{1f600}".repeat(Math.min(Math.floor(room / 4), 1000));
    }
    expect(validateWorkspace(v1).ok).toBe(true);
    const storage = memory();
    storage.items.set(bucketKey(ANON), JSON.stringify(v1));
    const read = readWorkspace(storage, ANON);
    expect(read.ok).toBe(true);
    expect(read.ok && exportBackup(read.workspace).ok).toBe(true);
  });

  test("every limit at once can pass 1 MiB, and such a bucket is refused rather than stored (reported case)", () => {
    const plans = Array.from({ length: 200 }, (_, i) => plan({ id: idOf(i + 1), name: `Plan ${i + 1}`, notes: "\u{1f600}".repeat(1000) }));
    const alts = Array.from({ length: 60 }, (_, i) => altOf({ id: idOf(500 + i), name: `Alt ${i}`, notes: "\u{1f600}".repeat(1000), planIds: plans.slice(0, 10).map((p) => p.id) }));
    expect(validateWorkspace(workspace(ANON, plans.map((p) => ({ ...p, notes: "" })), { alts })).ok).toBe(true);
    expect(validateWorkspace(workspace(ANON, plans, { alts }))).toEqual({ ok: false, error: "over-limit" });
  });

  test("a restore into a version 1 bucket is checked as it would be stored: in version 1, at version 1's size", () => {
    const { plans, alts } = nearFull();
    const storage = memory();
    storage.items.set(bucketKey(ANON), JSON.stringify(versionOne(ANON, plans, alts)));
    const read = readWorkspace(storage, ANON);
    if (!read.ok) throw new Error(read.error);
    // One plan more, as long as the rest, would take the stored bucket past 1 MiB: refused as over the limit.
    const more = previewImport(JSON.stringify(versionOne(ANON, [plan({ id: idOf(499), name: "Plan 499", notes: letters(1000) })])), read.workspace);
    expect(more).toMatchObject({ ok: false, error: "over-limit" });
    // A backup of the same bucket, one plan's notes changed later: it fits in version 1, though not in version 2.
    const changed = [{ ...plans[0], notes: "Shorter", updatedAt: LATER.toISOString() }, ...plans.slice(1)];
    const preview = previewImport(JSON.stringify(versionOne(ANON, changed, alts)), read.workspace);
    if (!preview.ok) throw new Error(preview.message);
    expect(preview.preview).toMatchObject({ updated: 1, unchanged: plans.length - 1, others: 0 });
    expect(applyImport(storage, ANON, preview.preview)).toMatchObject({ ok: true });
    expect(storage.items.get(bucketKey(ANON))).toBe(JSON.stringify(versionOne(ANON, changed, alts)));
  });

  test("a version 1 backup restores into a version 2 device, its alts' new details unknown", () => {
    const preview = previewImport(JSON.stringify(versionOne(ANON, [one()], [oldAlt])), emptyWorkspace(ANON));
    expect(preview).toMatchObject({ ok: true, preview: { added: 1, others: 1 } });
    expect(preview.ok && preview.preview.result).toEqual(workspace(ANON, [one()], { alts: [upgraded] }));
  });

  test("version 1 is never extended in place: version 2's fields on a version 1 alt, or a version 2 alt without them, are refused", () => {
    expect(validateWorkspace(versionOne(ANON, [one()], [{ ...oldAlt, realm: "Moon Guard" }]))).toMatchObject({ ok: false, error: "malformed" });
    expect(validateWorkspace(versionOne(ANON, [one()], [upgraded]))).toMatchObject({ ok: false, error: "malformed" });
    expect(validateWorkspace(workspace(ANON, [one()], { alts: [oldAlt as unknown as LocalAlt] }))).toMatchObject({ ok: false, error: "malformed" });
  });

  test("a version 2 alt's details are checked: realm, class, faction, level, professions and where they came from", () => {
    const valid = (over: object) => validateWorkspace(workspace(ANON, [one()], { alts: [altOf(over as Partial<LocalAlt>)] })).ok;
    const fromFile = { source: "addon-file", fileRecordAt: "2026-10-21T18:00:00.000Z", fileDetails: ["classSlug", "level", "faction"] };
    expect(valid({ realm: "Moon Guard", classSlug: "shaman", faction: "horde", level: 60, professions: ["Alchemy", "First Aid"], provenance: fromFile })).toBe(true);
    expect(valid({ provenance: { source: "manual", fileRecordAt: "2026-10-21T18:00:00.000Z", fileDetails: [] } })).toBe(true);
    for (const bad of [
      { realm: "" }, { realm: "r".repeat(61) }, { realm: "Moon\u0007Guard" }, { realm: " Moon Guard" },
      { classSlug: "deathknight" }, { classSlug: "toString" }, { classSlug: "Mage" },
      { faction: "Horde" }, { faction: "neutral" },
      { level: 0 }, { level: 61 }, { level: 24.5 }, { level: "24" },
      { professions: ["Jewelcrafting"] }, { professions: ["Alchemy", "Alchemy"] }, { professions: "Alchemy" },
      { provenance: { source: "typed", fileRecordAt: null, fileDetails: [] } },
      { provenance: { source: "addon-file", fileRecordAt: null, fileDetails: [] } },
      { provenance: { source: "manual", fileRecordAt: null, fileDetails: ["level"] }, level: 24 },
      { provenance: { ...fromFile, fileDetails: ["level"] } },
      { provenance: { ...fromFile, fileDetails: ["realm"] }, realm: "Moon Guard" },
      { provenance: { ...fromFile, extra: 1 } },
    ]) expect(valid(bad), JSON.stringify(bad)).toBe(false);
  });
});

describe("limits", () => {
  test("a device keeps 200 plans: the 201st is refused and nothing changes", () => {
    const storage = memory();
    storage.items.set(bucketKey(ANON), JSON.stringify(workspace(ANON, Array.from({ length: 200 }, (_, i) => plan({ id: idOf(i), name: `Plan ${i}` })))));
    const before = storage.items.get(bucketKey(ANON));
    expect(WORKSPACE_LIMITS.plans).toBe(200);
    expect(savePlan(storage, ANON, input(), NOW)).toMatchObject({ ok: false, error: "over-limit" });
    expect(storage.items.get(bucketKey(ANON))).toBe(before);
  });

  test("a name is 1 to 60 characters and notes up to 1,000: longer is refused, never cut", () => {
    const storage = memory();
    expect(savePlan(storage, ANON, input({ name: "a".repeat(60), notes: "n".repeat(1000) }), NOW).ok).toBe(true);
    expect(savePlan(storage, ANON, input({ name: "a".repeat(61) }), NOW)).toMatchObject({ ok: false, error: "invalid" });
    expect(savePlan(storage, ANON, input({ name: "   " }), NOW)).toMatchObject({ ok: false, error: "invalid" });
    expect(savePlan(storage, ANON, input({ notes: "n".repeat(1001) }), NOW)).toMatchObject({ ok: false, error: "invalid" });
    expect(names(storage, ANON)).toEqual(["a".repeat(60)]);
  });

  test("a name and notes are kept as plain text: spaces trimmed and control characters left out", () => {
    const storage = memory();
    const kept = saved(storage, ANON, { name: "  Frost\u0007 pvp ", notes: "line one\r\nline two\u0000" });
    expect(kept.name).toBe("Frost pvp");
    expect(kept.notes).toBe("line one\nline two");
  });

  test("a share code is at most 400 characters, and both sets are the same class as the plan", () => {
    const storage = memory();
    const ranks = Object.fromEntries(Array.from({ length: 59 }, (_, i) => [i + 1, { rank: 1 }]));
    const long = encodeBuild({ classSlug: "mage", specId: 0, build: "1.60.1.70450", ranks });
    expect(long.length).toBeGreaterThan(400);
    expect(savePlan(storage, ANON, input({ codes: [long, null], orders: [null, null] }), NOW)).toMatchObject({ ok: false, error: "invalid" });
    expect(savePlan(storage, ANON, input({ codes: [MAGE, DRUID], orders: [null, null] }), NOW)).toMatchObject({ ok: false, error: "invalid" });
    expect(savePlan(storage, ANON, input({ classSlug: "druid" }), NOW)).toMatchObject({ ok: false, error: "invalid" });
    expect(savePlan(storage, ANON, input({ codes: ["EL1-mage-garbage", null] }), NOW)).toMatchObject({ ok: false, error: "invalid" });
    expect(savePlan(storage, ANON, input({ codes: [null, MAGE], orders: [null, PLANNED] }), NOW)).toMatchObject({ ok: false, error: "invalid" });
    expect(storage.items.size).toBe(0);
  });

  test("alts hold 60 at most, 10 plan references each, and every reference names a plan in the same bucket", () => {
    const plans = Array.from({ length: 11 }, (_, i) => plan({ id: idOf(i), name: `Plan ${i}` }));
    const alt = (n: number, planIds: string[]) => altOf({ id: idOf(500 + n), name: `Alt ${n}`, planIds });
    expect(validateWorkspace(workspace(ANON, plans, { alts: [alt(1, plans.slice(0, 10).map((p) => p.id))] })).ok).toBe(true);
    expect(validateWorkspace(workspace(ANON, plans, { alts: [alt(1, plans.map((p) => p.id))] }))).toMatchObject({ ok: false, error: "over-limit" });
    expect(validateWorkspace(workspace(ANON, plans, { alts: Array.from({ length: 61 }, (_, i) => alt(i, [])) }))).toMatchObject({ ok: false, error: "over-limit" });
    expect(validateWorkspace(workspace(ANON, plans, { alts: [alt(1, [idOf(99)])] }))).toMatchObject({ ok: false, error: "bad-reference" });
  });

  test("a watch names a plan in the same bucket, once", () => {
    const plans = [plan()];
    const watch = (n: number, planId: string) => ({ id: idOf(700 + n), planId, addedAt: "2026-10-20T12:00:00.000Z" });
    expect(validateWorkspace(workspace(ANON, plans, { watches: [watch(1, plans[0].id)] })).ok).toBe(true);
    expect(validateWorkspace(workspace(ANON, plans, { watches: [watch(1, idOf(99))] }))).toMatchObject({ ok: false, error: "bad-reference" });
    expect(validateWorkspace(workspace(ANON, plans, { watches: [watch(1, plans[0].id), watch(2, plans[0].id)] }))).toMatchObject({ ok: false, error: "bad-reference" });
  });

  test("a stored workspace with fields the format does not have is refused rather than kept blindly", () => {
    expect(validateWorkspace({ ...workspace(ANON, [plan()]), extra: 1 })).toMatchObject({ ok: false, error: "malformed" });
    expect(validateWorkspace(workspace(ANON, [{ ...plan(), script: "alert(1)" } as LocalPlan]))).toMatchObject({ ok: false, error: "malformed" });
    expect(validateWorkspace(workspace(ANON, [plan(), plan()]))).toMatchObject({ ok: false, error: "malformed" });
  });

  test("everything a device keeps fits a 1 MiB backup: a save that would pass it is refused", () => {
    // Plans as large as the limits allow: four-byte letters in the name and notes, two codes and two tokens near
    // 400 characters (58 one-point nodes is the longest mage code under 400).
    const ranks = Object.fromEntries(Array.from({ length: 58 }, (_, i) => [i + 1, { rank: 1 }]));
    const long = encodeBuild({ classSlug: "mage", specId: 0, build: "1.60.1.70450", ranks });
    expect(long.length).toBeLessThanOrEqual(400);
    const token = `O1p-${"A".repeat(396)}`;
    const letters = (n: number) => "\u{1D538}".repeat(n);
    const big = (n: number) => plan({ id: idOf(n), name: letters(60), notes: letters(1000), code: long, code2: long, order: token, order2: token });
    const size = (n: number) => bytes(JSON.stringify(workspace(ANON, Array.from({ length: n }, (_, i) => big(i)))));
    const fits = 1 + Math.floor((WORKSPACE_LIMITS.bytes - size(1)) / (size(2) - size(1)));
    expect(size(fits)).toBeLessThanOrEqual(1024 * 1024);
    expect(size(fits + 1)).toBeGreaterThan(1024 * 1024);
    expect(fits).toBeLessThan(200);
    const storage = memory();
    storage.items.set(bucketKey(ANON), JSON.stringify(workspace(ANON, Array.from({ length: fits }, (_, i) => big(i)))));
    const before = storage.items.get(bucketKey(ANON));
    expect(readWorkspace(storage, ANON).ok).toBe(true);
    expect(savePlan(storage, ANON, input({ name: letters(60), notes: letters(1000), codes: [long, long], orders: [token, token] }), NOW))
      .toMatchObject({ ok: false, error: "over-limit" });
    expect(storage.items.get(bucketKey(ANON))).toBe(before);
    expect(validateWorkspace(workspace(ANON, Array.from({ length: fits + 1 }, (_, i) => big(i))))).toMatchObject({ ok: false, error: "over-limit" });
  });
});

describe("spend orders", () => {
  test("a plan keeps the tokens it was given: a newer or damaged one keeps its talents and reads as unknown", () => {
    const storage = memory();
    const newer = saved(storage, ANON, { name: "Newer", orders: ["O2p-AABCC", null] });
    expect(newer.code).toBe(MAGE);
    expect(newer.order).toBe("O2p-AABCC");
    expect(orderState(newer.code, newer.order)).toEqual({ known: false, reason: "newer-version" });
    const damaged = saved(storage, ANON, { name: "Damaged", orders: ["O1p-AABC", null] });
    expect(orderState(damaged.code, damaged.order)).toEqual({ known: false, reason: "missing-points" });
  });

  test("orderState reads the token against its own code: planned, provisional, or unknown when there is none", () => {
    expect(orderState(MAGE, PLANNED)).toEqual({ known: true, origin: "planned" });
    expect(orderState(MAGE, "O1g-AABCC")).toEqual({ known: true, origin: "provisional" });
    expect(orderState(MAGE, null)).toEqual({ known: false, reason: "none" });
    expect(orderState(MAGE_SMALL, PLANNED)).toEqual({ known: false, reason: "extra-points" });
  });

  test("an order rides only with its own set's code, as links leave it out", () => {
    const storage = memory();
    const kept = saved(storage, ANON, { codes: [MAGE, null], orders: [PLANNED, "O1p-A"] });
    expect(kept.order).toBe(PLANNED);
    expect(kept.order2).toBeNull();
  });

  test("a token with characters a link cannot carry is refused, so it cannot add a key to the plan's link", () => {
    const storage = memory();
    expect(savePlan(storage, ANON, input({ orders: [`${PLANNED}&plan2=${DRUID}`, null] }), NOW)).toMatchObject({ ok: false, error: "invalid" });
    expect(storage.items.size).toBe(0);
  });
});

describe("edit, copy and delete", () => {
  test("saving with a plan's id updates it in place: same id, new codes, new time", () => {
    const storage = memory();
    const first = saved(storage, ANON);
    const update = savePlan(storage, ANON, input({ id: first.id, name: "Frost raid", codes: [MAGE_SMALL, MAGE], orders: ["O1p-A", PLANNED] }), LATER);
    expect(update).toMatchObject({ ok: true, plan: { id: first.id, name: "Frost raid", code: MAGE_SMALL, code2: MAGE, order: "O1p-A", order2: PLANNED, updatedAt: LATER.toISOString() } });
    expect(names(storage, ANON)).toEqual(["Frost raid"]);
  });

  test("an update for a plan that is gone, or of another class, is refused", () => {
    const storage = memory();
    const first = saved(storage, ANON);
    expect(savePlan(storage, ANON, input({ id: idOf(42) }), NOW)).toMatchObject({ ok: false, error: "missing" });
    expect(savePlan(storage, ANON, input({ id: first.id, classSlug: "druid", codes: [DRUID, null], orders: [null, null] }), NOW)).toMatchObject({ ok: false, error: "invalid" });
  });

  test("editing a plan's name and notes keeps its codes and orders and stamps the time", () => {
    const storage = memory();
    const first = saved(storage, ANON);
    const edit = editPlan(storage, ANON, first.id, { name: "Frost pvp", notes: "Arena" }, LATER);
    expect(edit).toMatchObject({ ok: true, plan: { ...first, name: "Frost pvp", notes: "Arena", updatedAt: LATER.toISOString() } });
    expect(editPlan(storage, ANON, first.id, { name: "", notes: "" }, LATER)).toMatchObject({ ok: false, error: "invalid" });
  });

  test("a copy is a new plan named (copy), with the same talents and orders and no binding", () => {
    const storage = memory();
    storage.items.set(bucketKey(A), JSON.stringify(workspace(A, [plan({ order: PLANNED, boundTo: { userId: A_ID, at: "2026-10-21T00:00:00.000Z" } })])));
    const copy = copyPlan(storage, A, plan().id, LATER);
    expect(copy).toMatchObject({ ok: true, plan: { name: "Frost (copy)", code: MAGE, order: PLANNED, boundTo: null, updatedAt: LATER.toISOString() } });
    expect(copy.ok && copy.plan.id).not.toBe(plan().id);
    expect(names(storage, A)).toEqual(["Frost", "Frost (copy)"]);
  });

  test("deleting removes only that plan; a plan that is gone says so and changes nothing", () => {
    const storage = memory();
    const one = saved(storage, ANON, { name: "One" });
    saved(storage, ANON, { name: "Two" });
    expect(deletePlan(storage, ANON, one.id)).toMatchObject({ ok: true });
    expect(names(storage, ANON)).toEqual(["Two"]);
    const before = storage.items.get(bucketKey(ANON));
    expect(deletePlan(storage, ANON, one.id)).toMatchObject({ ok: false, error: "missing" });
    expect(storage.items.get(bucketKey(ANON))).toBe(before);
  });

  test("a plan an alt or a watch refers to is not deleted out from under it", () => {
    const storage = memory();
    const watch = { id: idOf(700), planId: plan().id, addedAt: "2026-10-20T12:00:00.000Z" };
    storage.items.set(bucketKey(ANON), JSON.stringify(workspace(ANON, [plan()], { watches: [watch] })));
    expect(deletePlan(storage, ANON, plan().id)).toMatchObject({ ok: false, error: "referenced" });
    expect(names(storage, ANON)).toEqual(["Frost"]);
  });
});

describe("binding after a transfer", () => {
  /** A transfer of these plans, sent for `owner`. */
  const sent = (owner: Owner, ...plans: LocalPlan[]) => ({ owner, planIds: plans.map((p) => p.id) });

  test("binding needs a finished transfer: a failed result binds nothing and changes nothing", () => {
    const storage = memory();
    const one = saved(storage, ANON);
    const before = new Map(storage.items);
    expect(bindTransferred(storage, sent(A, one), { ok: false }, LATER)).toMatchObject({ ok: false, error: "not-transferred" });
    expect(storage.items).toEqual(before);
    expect(names(storage, ANON)).toEqual([one.name]);
  });

  test("a transfer that confirms every plan sent moves exactly those into that account, bound to it; the rest stay signed out", () => {
    const storage = memory();
    const moved = saved(storage, ANON, { name: "Moved" });
    saved(storage, ANON, { name: "Stays" });
    expect(bindTransferred(storage, sent(A, moved), { ok: true, userId: A_ID, planIds: [moved.id] }, LATER)).toEqual({ ok: true, bound: 1 });
    expect(names(storage, ANON)).toEqual(["Stays"]);
    const account = readWorkspace(storage, A);
    expect(account.ok && account.workspace.plans).toEqual([{ ...moved, boundTo: { userId: A_ID, at: LATER.toISOString() } }]);
    expect(names(storage, B)).toEqual([]);
  });

  test("a result that confirms only some of the plans sent, or one that was not sent, binds none of them", () => {
    const storage = memory();
    const one = saved(storage, ANON, { name: "One" });
    const two = saved(storage, ANON, { name: "Two" });
    const before = new Map(storage.items);
    expect(bindTransferred(storage, sent(A, one, two), { ok: true, userId: A_ID, planIds: [one.id] }, LATER)).toMatchObject({ ok: false, error: "incomplete" });
    expect(bindTransferred(storage, sent(A, one), { ok: true, userId: A_ID, planIds: [one.id, two.id] }, LATER)).toMatchObject({ ok: false, error: "incomplete" });
    expect(storage.items).toEqual(before);
    expect(names(storage, ANON)).toEqual(["One", "Two"]);
  });

  test("a result for another account than the one the transfer was sent for binds nothing", () => {
    const storage = memory();
    const one = saved(storage, ANON);
    const before = new Map(storage.items);
    expect(bindTransferred(storage, sent(A, one), { ok: true, userId: B_ID, planIds: [one.id] }, LATER)).toMatchObject({ ok: false, error: "other-owner" });
    expect(bindTransferred(storage, sent(ANON, one), { ok: true, userId: A_ID, planIds: [one.id] }, LATER)).toMatchObject({ ok: false, error: "other-owner" });
    expect(storage.items).toEqual(before);
  });

  test("a retried transfer does not add a plan to the account's bucket twice", () => {
    const storage = memory();
    const one = saved(storage, ANON);
    bindTransferred(storage, sent(A, one), { ok: true, userId: A_ID, planIds: [one.id] }, LATER);
    // An interrupted bind can leave the signed-out copy behind; the retry ends with one copy, in the account.
    storage.items.set(bucketKey(ANON), JSON.stringify(workspace(ANON, [one])));
    expect(bindTransferred(storage, sent(A, one), { ok: true, userId: A_ID, planIds: [one.id] }, LATER)).toEqual({ ok: true, bound: 1 });
    expect(bindTransferred(storage, sent(A, one), { ok: true, userId: A_ID, planIds: [one.id] }, LATER)).toEqual({ ok: true, bound: 0 });
    expect(names(storage, A)).toEqual([one.name]);
    expect(names(storage, ANON)).toEqual([]);
  });

  test("a full account bucket refuses the bind before anything moves", () => {
    const storage = memory();
    storage.items.set(bucketKey(A), JSON.stringify(workspace(A, Array.from({ length: 200 }, (_, i) => plan({ id: idOf(i), name: `Plan ${i}` })))));
    const one = saved(storage, ANON);
    const before = new Map(storage.items);
    expect(bindTransferred(storage, sent(A, one), { ok: true, userId: A_ID, planIds: [one.id] }, LATER)).toMatchObject({ ok: false, error: "over-limit" });
    expect(storage.items).toEqual(before);
  });

  test("when the signed-out copy cannot be taken out, the plan is in both buckets, never in neither, and the result says so", () => {
    const storage = memory();
    const one = saved(storage, ANON);
    const stuck = { ...storage, setItem: (key: string, value: string) => {
      if (key === bucketKey(ANON)) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      storage.setItem(key, value);
    } };
    expect(bindTransferred(stuck, sent(A, one), { ok: true, userId: A_ID, planIds: [one.id] }, LATER)).toMatchObject({ ok: false, error: "left-signed-out" });
    expect(names(storage, A)).toEqual([one.name]);
    expect(names(storage, ANON)).toEqual([one.name]);
  });
});

describe("backup and restore", () => {
  test("a backup holds only the active bucket, with its binding metadata", () => {
    const storage = memory();
    saved(storage, ANON, { name: "Signed out" });
    storage.items.set(bucketKey(A), JSON.stringify(workspace(A, [plan({ boundTo: { userId: A_ID, at: "2026-10-21T00:00:00.000Z" } })])));
    saved(storage, B, { name: "B's plan" });
    const read = readWorkspace(storage, A);
    const backup = read.ok ? exportBackup(read.workspace, NOW) : null;
    expect(backup).toMatchObject({ ok: true, fileName: "everloot-plans-2026-10-26.json" });
    const doc = JSON.parse(backup!.ok ? backup!.text : "null");
    expect(doc.owner).toEqual(A);
    expect(doc.plans).toEqual([plan({ boundTo: { userId: A_ID, at: "2026-10-21T00:00:00.000Z" } })]);
    expect(backup!.ok && backup!.text).not.toContain("Signed out");
    expect(backup!.ok && backup!.text).not.toContain("B's plan");
  });

  test("a restore that is over 1 MiB is refused before it is read", () => {
    const current = emptyWorkspace(ANON);
    expect(previewImport(" ".repeat(WORKSPACE_LIMITS.bytes + 1), current)).toMatchObject({ ok: false, error: "too-large" });
    // Four-byte letters: under the limit in characters, over it in bytes.
    expect(previewImport(`"${"\u{1D538}".repeat(300_000)}"`, current)).toMatchObject({ ok: false, error: "too-large" });
  });

  test("text that is not a backup is refused, and a backup from a newer version is refused, changing nothing", () => {
    const current = emptyWorkspace(ANON);
    expect(previewImport("{not json", current)).toMatchObject({ ok: false, error: "malformed" });
    expect(previewImport(JSON.stringify({ plans: [] }), current)).toMatchObject({ ok: false, error: "malformed" });
    expect(previewImport(JSON.stringify({ format: "everloot.player-workspace", version: NEWEST_VERSION + 1, owner: ANON }), current)).toMatchObject({ ok: false, error: "newer-version" });
  });

  test("a backup restores only into the bucket it came from: never across accounts or between signed out and signed in", () => {
    const fromA = JSON.stringify(workspace(A, [plan({ boundTo: { userId: A_ID, at: "2026-10-21T00:00:00.000Z" } })]));
    expect(previewImport(fromA, emptyWorkspace(B))).toMatchObject({ ok: false, error: "other-owner" });
    expect(previewImport(fromA, emptyWorkspace(ANON))).toMatchObject({ ok: false, error: "other-owner" });
    expect(previewImport(JSON.stringify(workspace(ANON, [plan()])), emptyWorkspace(A))).toMatchObject({ ok: false, error: "other-owner" });
    expect(previewImport(fromA, emptyWorkspace(A)).ok).toBe(true);
  });

  test("a backup whose owner was changed by hand is refused when its plans are bound to someone else", () => {
    const edited = JSON.stringify(workspace(B, [plan({ boundTo: { userId: A_ID, at: "2026-10-21T00:00:00.000Z" } })]));
    expect(previewImport(edited, emptyWorkspace(B))).toMatchObject({ ok: false, error: "malformed" });
  });

  test("a restore previews first: new plans are added, older ones updated, newer ones on the device kept", () => {
    const device = workspace(ANON, [
      plan({ id: idOf(1), name: "Same", updatedAt: "2026-10-20T12:00:00.000Z" }),
      plan({ id: idOf(2), name: "Old here", updatedAt: "2026-10-20T12:00:00.000Z" }),
      plan({ id: idOf(3), name: "New here", updatedAt: "2026-10-25T12:00:00.000Z" }),
    ]);
    const backup = workspace(ANON, [
      plan({ id: idOf(1), name: "Same", updatedAt: "2026-10-20T12:00:00.000Z" }),
      plan({ id: idOf(2), name: "Newer in backup", updatedAt: "2026-10-22T12:00:00.000Z" }),
      plan({ id: idOf(3), name: "Older in backup", updatedAt: "2026-10-21T12:00:00.000Z" }),
      plan({ id: idOf(4), name: "Only in backup" }),
    ]);
    const preview = previewImport(JSON.stringify(backup), device);
    expect(preview).toMatchObject({ ok: true, preview: { added: 1, updated: 1, kept: 1, unchanged: 1, others: 0, warnings: [] } });
    expect(preview.ok && preview.preview.result.plans.map((p) => p.name).sort()).toEqual(["New here", "Newer in backup", "Only in backup", "Same"]);
  });

  test("a restore keeps a binding the device already has: an older unbound copy does not unbind it", () => {
    const bound = { userId: A_ID, at: "2026-10-21T00:00:00.000Z" };
    const device = workspace(A, [plan({ boundTo: bound, updatedAt: "2026-10-20T12:00:00.000Z" })]);
    const backup = workspace(A, [plan({ name: "Renamed later", updatedAt: "2026-10-22T12:00:00.000Z" })]);
    const preview = previewImport(JSON.stringify(backup), device);
    expect(preview.ok && preview.preview.result.plans).toEqual([plan({ name: "Renamed later", updatedAt: "2026-10-22T12:00:00.000Z", boundTo: bound })]);
  });

  test("a restore that would take the device past 200 plans is refused whole", () => {
    const device = workspace(ANON, Array.from({ length: 150 }, (_, i) => plan({ id: idOf(i), name: `Here ${i}` })));
    const backup = workspace(ANON, Array.from({ length: 60 }, (_, i) => plan({ id: idOf(1000 + i), name: `Backup ${i}` })));
    expect(previewImport(JSON.stringify(backup), device)).toMatchObject({ ok: false, error: "over-limit" });
  });

  test("a restore says which plans' orders cannot be read here, and keeps their talents and tokens", () => {
    const backup = workspace(ANON, [plan({ id: idOf(1), name: "Future", order: "O2p-AABCC" }), plan({ id: idOf(2), name: "Fine", order: PLANNED })]);
    const preview = previewImport(JSON.stringify(backup), emptyWorkspace(ANON));
    expect(preview.ok && preview.preview.warnings).toEqual([
      "Future: set 1's spend order was made by a newer version of Everloot, so it opens as unknown. Its talents are restored.",
    ]);
    expect(preview.ok && preview.preview.result.plans.find((p) => p.name === "Future")).toMatchObject({ code: MAGE, order: "O2p-AABCC" });
  });

  test("applying a preview writes exactly what it showed; the same backup again changes nothing", () => {
    const storage = memory();
    saved(storage, ANON, { name: "Here" });
    const read = readWorkspace(storage, ANON);
    const preview = read.ok ? previewImport(JSON.stringify(workspace(ANON, [plan({ name: "Restored" })])), read.workspace) : null;
    expect(preview?.ok).toBe(true);
    expect(applyImport(storage, ANON, preview!.ok ? preview!.preview : (null as never))).toMatchObject({ ok: true });
    expect(names(storage, ANON)).toEqual(["Here", "Restored"]);
    const again = readWorkspace(storage, ANON);
    const second = again.ok ? previewImport(JSON.stringify(workspace(ANON, [plan({ name: "Restored" })])), again.workspace) : null;
    expect(second).toMatchObject({ ok: true, preview: { added: 0, updated: 0, unchanged: 1 } });
  });

  test("a preview is not applied once the device changed since, or to another owner after a switch", () => {
    const storage = memory();
    saved(storage, ANON, { name: "Here" });
    const read = readWorkspace(storage, ANON);
    const preview = read.ok ? previewImport(JSON.stringify(workspace(ANON, [plan({ name: "Restored" })])), read.workspace) : null;
    if (!preview?.ok) throw new Error("no preview");
    expect(applyImport(storage, A, preview.preview)).toMatchObject({ ok: false, error: "other-owner" });
    expect(names(storage, A)).toEqual([]);
    saved(storage, ANON, { name: "From another tab" });
    expect(applyImport(storage, ANON, preview.preview)).toMatchObject({ ok: false, error: "changed" });
    expect(names(storage, ANON)).toEqual(["From another tab", "Here"]);
  });

  test("a full storage during a restore keeps the device as it was", () => {
    const storage = memory();
    saved(storage, ANON, { name: "Here" });
    const before = storage.items.get(bucketKey(ANON));
    const read = readWorkspace(storage, ANON);
    const preview = read.ok ? previewImport(JSON.stringify(workspace(ANON, [plan({ name: "Restored" })])), read.workspace) : null;
    if (!preview?.ok) throw new Error("no preview");
    const full = { ...storage, setItem: () => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); } };
    expect(applyImport(full, ANON, preview.preview)).toMatchObject({ ok: false, error: "full" });
    expect(storage.items.get(bucketKey(ANON))).toBe(before);
  });
});

describe("the account and pasted links", () => {
  const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

  test("lookupOwner takes only the stable id from /api/auth/me: signed out is the signed-out bucket, anything else unknown", async () => {
    const urls: string[] = [];
    const me = async (url: RequestInfo | URL) => { urls.push(String(url)); return new Response(JSON.stringify({ user: { id: A_ID, name: "Thrall#1234", entitlements: [] } })); };
    expect(await lookupOwner(me as typeof fetch)).toEqual({ ok: true, owner: A });
    expect(urls).toEqual(["/api/auth/me"]);
    expect(await lookupOwner(respond(200, { user: null }) as typeof fetch)).toEqual({ ok: true, owner: ANON });
    expect(await lookupOwner(respond(503, { error: "Authentication is temporarily unavailable" }) as typeof fetch)).toEqual({ ok: false });
    expect(await lookupOwner(respond(200, { user: { id: "Thrall#1234" } }) as typeof fetch)).toEqual({ ok: false });
    expect(await lookupOwner(respond(200, {}) as typeof fetch)).toEqual({ ok: false });
    expect(await lookupOwner((async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch)).toEqual({ ok: false });
  });

  test("readPlanText takes a class page link with both sets and orders, a build link's path, or a bare code", () => {
    expect(readPlanText(`https://everloot.app/tools/talents/mage#plan=${MAGE}&plan2=${MAGE_SMALL}&order=${PLANNED}&order2=O1g-A`))
      .toEqual({ ok: true, classSlug: "mage", codes: [MAGE, MAGE_SMALL], orders: [PLANNED, "O1g-A"] });
    expect(readPlanText(`https://everloot.app/tools/talents/mage/b/${MAGE}/${MAGE_SMALL}`))
      .toEqual({ ok: true, classSlug: "mage", codes: [MAGE, MAGE_SMALL], orders: [null, null] });
    expect(readPlanText(`  ${MAGE}  `)).toEqual({ ok: true, classSlug: "mage", codes: [MAGE, null], orders: [null, null] });
  });

  test("readPlanText keeps a build link's orders from its fragment, each with its own set, as they came", () => {
    const build = `https://everloot.app/tools/talents/mage/b/${MAGE}/${MAGE_SMALL}`;
    expect(readPlanText(`${build}#order=${PLANNED}&order2=O1g-A`))
      .toEqual({ ok: true, classSlug: "mage", codes: [MAGE, MAGE_SMALL], orders: [PLANNED, "O1g-A"] });
    expect(readPlanText(`${build}#order2=O1g-A`))
      .toEqual({ ok: true, classSlug: "mage", codes: [MAGE, MAGE_SMALL], orders: [null, "O1g-A"] });
    expect(readPlanText(`${build}#order=O2p-AABCC&order2=not-an-order`))
      .toEqual({ ok: true, classSlug: "mage", codes: [MAGE, MAGE_SMALL], orders: ["O2p-AABCC", "not-an-order"] });
    expect(readPlanText(`https://everloot.app/tools/talents/mage/b/${MAGE}#consent=rejected&order=${PLANNED}&order2=O1g-A`))
      .toEqual({ ok: true, classSlug: "mage", codes: [MAGE, null], orders: [PLANNED, null] });
    expect(readPlanText(`https://everloot.app/tools/talents/mage/b/${MAGE}?ref=x&order=O1g-A`))
      .toEqual({ ok: true, classSlug: "mage", codes: [MAGE, null], orders: [null, null] });
  });

  test("readPlanText refuses empty text, other links, a link without a first set and sets of two classes", () => {
    expect(readPlanText("   ")).toMatchObject({ ok: false });
    expect(readPlanText("https://everloot.app/b/AbCd1234")).toMatchObject({ ok: false });
    expect(readPlanText(`https://everloot.app/tools/talents/mage#plan2=${MAGE}&order=${PLANNED}`)).toMatchObject({ ok: false });
    expect(readPlanText(`https://everloot.app/tools/talents/mage/b/-/${MAGE}`)).toMatchObject({ ok: false });
    expect(readPlanText(`https://everloot.app/tools/talents/mage#plan=${MAGE}&plan2=${DRUID}`)).toMatchObject({ ok: false });
  });
});
