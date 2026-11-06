import { describe, expect, it, vi } from "vitest";
import { createGearBoardStore, GEAR_BOARD_KEY, type GearBoardStore } from "./gear-board-store";
import { liveBoard, updatedLine, type GearBoardSnapshot } from "./leaderboards";
import { foldBoard, loadTrack, needsFull, writeGearBoard } from "./profile-pipeline";

// Item 1: a head (inventory type 1) at 60 in the files; item 2: a ring (11) at 50.
const FILES = new Map([[1, { inventoryType: 1, level: 60 }], [2, { inventoryType: 11, level: 50 }]]);
const files = (id: number) => FILES.get(id);
const HEAD = { slot: "HeadSlot", itemId: 1, itemLevel: 60 };
const RING = { slot: "Finger0Slot", itemId: 2, itemLevel: 50 };
function row(id: string, name: string, equipped: object[], received = "2026-11-06T10:00:00.123456+00:00", captured = "2026-11-06T09:00:00Z") {
  return { link_id: id, ruleset: "forever", realm: "CAMWOW US1 Realm 4 PvP", name, race: "Orc", class: "SHAMAN", faction: "Horde", level: 60,
    captured_at: captured, received_at: received, data: { equipped } };
}
const NOW = new Date("2026-11-06T12:00:00Z");
const live = (...ids: string[]) => new Set(ids);

describe("folding a run into the stored boards", () => {
  it("a full pass scores every row, keeps why each refused one was left out, and sets the watermark", () => {
    const { snapshot, scored } = foldBoard(null, live("a", "b", "c"), [
      row("a", "Helmy", [HEAD], "2026-11-06T10:00:00.5+00:00"),
      row("b", "Faker", [{ ...HEAD, itemLevel: 80 }], "2026-11-06T11:00:00.25+00:00"),
      row("c", "Ringo", [RING], "2026-11-05T08:00:00+00:00"),
    ], files, NOW, true);
    expect(snapshot.entries.map((e) => [e.linkId, e.name])).toEqual([["a", "Helmy"], ["c", "Ringo"]]);
    expect(snapshot.refused).toEqual({ b: "level_mismatch" });
    expect(snapshot.watermark).toBe("2026-11-06T11:00:00.25+00:00");
    expect(snapshot.fullAt).toBe(NOW.toISOString());
    expect(scored.map((e) => e.linkId)).toEqual(["a", "c"]);
  });

  it("an incremental run keeps the links still on the boards, replaces the ones it read, and drops the rest", () => {
    const first = foldBoard(null, live("a", "b", "c"), [row("a", "Helmy", [HEAD]), row("b", "Faker", [{ ...HEAD, itemLevel: 80 }]), row("c", "Ringo", [RING])], files, NOW, true).snapshot;
    const later = new Date("2026-11-06T12:30:00Z");
    // c turned ranking off; b fixed its gear; a did nothing.
    const { snapshot, scored } = foldBoard(first, live("a", "b"), [row("b", "Faker", [HEAD], "2026-11-06T12:10:00+00:00")], files, later, false);
    expect(snapshot.entries.map((e) => e.linkId).sort()).toEqual(["a", "b"]);
    expect(snapshot.refused).toEqual({});
    expect(scored.map((e) => e.linkId)).toEqual(["b"]);
    expect(snapshot.fullAt).toBe(first.fullAt);
    expect(snapshot.watermark).toBe("2026-11-06T12:10:00+00:00");
    expect(snapshot.generatedAt).toBe(later.toISOString());
    // A row for a link that left the boards between the two reads is not taken.
    expect(foldBoard(first, live("a"), [row("b", "Faker", [HEAD])], files, later, false).snapshot.entries.map((e) => e.linkId)).toEqual(["a"]);
  });

  it("a run is full when there is no snapshot or none yet this UTC day", () => {
    const s = foldBoard(null, live(), [], files, NOW, true).snapshot;
    expect(needsFull(null, NOW)).toBe(true);
    expect(needsFull(s, new Date("2026-11-06T23:59:00Z"))).toBe(false);
    expect(needsFull(s, new Date("2026-11-07T00:00:00Z"))).toBe(true);
  });
});

describe("what a page shows of the stored boards", () => {
  const snapshot = foldBoard(null, live("a", "b", "c"), [row("a", "Helmy", [HEAD]), row("b", "Faker", [{ ...HEAD, itemLevel: 80 }]), row("c", "Ringo", [RING])], files, NOW, true).snapshot;

  it("only links on the boards right now: one switched off since the run is gone, and so is its not-counted line", () => {
    expect(liveBoard(snapshot, live("a", "b", "c"))).toMatchObject({ state: "ready", notCounted: 1, generatedAt: NOW.toISOString() });
    const now = liveBoard(snapshot, live("c"));
    expect(now.state === "ready" && now.entries.map((e) => e.name)).toEqual(["Ringo"]);
    expect(now.state === "ready" && now.notCounted).toBe(0);
  });

  it("says how old the stored boards are", () => {
    expect(updatedLine("2026-11-06T11:48:30Z", NOW)).toBe("Updated 11 min ago");
    expect(updatedLine("2026-11-06T11:59:40Z", NOW)).toBe("Updated just now");
    expect(updatedLine("2026-11-06T07:00:00Z", NOW)).toBe("Updated 5 h ago");
    expect(updatedLine("2026-11-01T12:00:00Z", NOW)).toBe("Updated 5 days ago");
    expect(updatedLine("nonsense", NOW)).toBe("Update time unrecorded");
  });
});

/** A store in memory, standing in for R2. */
function memoryStore(initial: GearBoardSnapshot | null = null): GearBoardStore & { saved: GearBoardSnapshot | null; writes: number } {
  const s = {
    saved: initial, writes: 0,
    read: async () => s.saved,
    write: async (snap: GearBoardSnapshot) => { s.saved = snap; s.writes++; },
  };
  return s;
}

/** The database: the links on the boards and their rows, answering the RPCs the run calls. */
function database(rows: ReturnType<typeof row>[], eligible = rows.map((r) => r.link_id)) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const query = vi.fn(async (path: string, init?: RequestInit): Promise<unknown> => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ path, body });
    if (path === "rpc/ranked_gear_links") return eligible.map((link_id) => ({ link_id }));
    if (path === "rpc/ranked_gear_board") {
      const since = body.p_since as string | undefined, ids = (body.p_link_ids as string[] | undefined) ?? [];
      return rows.filter((r) => eligible.includes(r.link_id) && (!since || Date.parse(r.received_at) >= Date.parse(since) || ids.includes(r.link_id)));
    }
    if (path === "rpc/record_character_track") return (body.p_points as unknown[]).length;
    throw new Error(`unexpected ${path}`);
  });
  return { query, calls };
}

describe("the cron run", () => {
  const loadFiles = async () => files;

  it("scores the boards, writes each scored character's points, then the snapshot", async () => {
    const db = database([row("a", "Helmy", [HEAD]), row("b", "Ringo", [RING])]);
    const store = memoryStore();
    const run = await writeGearBoard({}, { query: db.query, store, files: loadFiles, now: NOW });
    expect(run).toEqual({ full: true, read: 2, scored: 2, entries: 2, points: 6 });
    expect(db.calls.map((c) => c.path)).toEqual(["rpc/ranked_gear_links", "rpc/ranked_gear_board", "rpc/record_character_track"]);
    expect(db.calls[1]!.body).toEqual({});
    const points = db.calls[2]!.body.p_points as { link_id: string; day: string; metric: string; value: number; version?: string }[];
    expect(points.filter((p) => p.link_id === "a")).toEqual([
      { link_id: "a", day: "2026-11-06", metric: "level", value: 60, source: "owner_sync" },
      { link_id: "a", day: "2026-11-06", metric: "item_level", value: Math.floor(60 / 17), source: "owner_sync" },
      { link_id: "a", day: "2026-11-06", metric: "gear_score", value: Math.floor((44 * 60) / 512), source: "owner_sync", version: "gear_score_v1" },
    ]);
    expect(store.saved?.entries).toHaveLength(2);
  });

  it("a later run the same day reads only new gear and links back on the boards, and writes points for those alone", async () => {
    const rows = [row("a", "Helmy", [HEAD], "2026-11-06T10:00:00+00:00"), row("b", "Ringo", [RING], "2026-11-06T10:00:00+00:00")];
    const store = memoryStore();
    await writeGearBoard({}, { ...database(rows, ["a"]), store, files: loadFiles, now: NOW });
    // b turns ranking back on without new gear; a sends nothing new; c is new.
    const db = database([...rows, row("c", "Newbie", [HEAD], "2026-11-06T12:20:00+00:00")]);
    const run = await writeGearBoard({}, { query: db.query, store, files: loadFiles, now: new Date("2026-11-06T12:30:00Z") });
    expect(db.calls[1]!.body).toEqual({ p_since: "2026-11-06T10:00:00+00:00", p_link_ids: ["b", "c"] });
    // a's row is read again because its received_at equals the watermark (the read is ">="); it changes nothing.
    expect(run).toMatchObject({ full: false, scored: 3, entries: 3 });
    const third = database([...rows, row("c", "Newbie", [HEAD], "2026-11-06T12:20:00+00:00")]);
    expect(await writeGearBoard({}, { query: third.query, store, files: loadFiles, now: new Date("2026-11-06T13:00:00Z") })).toMatchObject({ read: 1, scored: 1 });
    expect(third.calls[1]!.body).toEqual({ p_since: "2026-11-06T12:20:00+00:00", p_link_ids: [] });
  });

  it("with nothing changed it writes no points; without the game files it keeps the boards it had", async () => {
    const rows = [row("a", "Helmy", [HEAD])];
    const store = memoryStore();
    await writeGearBoard({}, { ...database(rows), store, files: loadFiles, now: NOW });
    const kept = store.saved;
    const idle = database([], ["a"]);
    expect(await writeGearBoard({}, { query: idle.query, store, files: loadFiles, now: new Date("2026-11-06T12:30:00Z") })).toMatchObject({ read: 0, points: 0, entries: 1 });
    expect(idle.calls.map((c) => c.path)).not.toContain("rpc/record_character_track");
    await expect(writeGearBoard({ rebuild: true }, { ...database(rows), store, files: async () => null, now: NOW })).rejects.toThrow(/game files/);
    expect(store.saved?.entries).toEqual(kept?.entries);
  });

  it("a failed points write leaves the snapshot as it was, so the next run writes them again", async () => {
    const db = database([row("a", "Helmy", [HEAD])]);
    const failing = vi.fn(async (path: string, init?: RequestInit): Promise<unknown> => {
      if (path === "rpc/record_character_track") throw new Error("down");
      return db.query(path, init);
    });
    const store = memoryStore();
    await expect(writeGearBoard({}, { query: failing, store, files: loadFiles, now: NOW })).rejects.toThrow("down");
    expect(store.writes).toBe(0);
  });
});

describe("the stored object", () => {
  const R2 = { r2AccountId: "acct", r2AccessKeyId: "id", r2SecretAccessKey: "secret", r2Bucket: "everloot-uploads" };
  const SNAP = foldBoard(null, live("a"), [row("a", "Helmy", [HEAD])], files, NOW, true).snapshot;

  it("is written to one key, read back, reused for a minute, and a missing or unusable one is no board", async () => {
    let t = 0;
    const fetch = vi.fn(async (req: Request) => (req.method === "PUT" ? new Response(null, { status: 200 }) : new Response(JSON.stringify(SNAP), { status: 200 })));
    const store = createGearBoardStore({ r2: R2, fetch: fetch as unknown as typeof globalThis.fetch, now: () => t });
    await store.write(SNAP);
    const put = fetch.mock.calls[0]![0];
    expect(put.url).toBe(`https://acct.r2.cloudflarestorage.com/everloot-uploads/${GEAR_BOARD_KEY}`);
    expect(await store.read()).toEqual(SNAP);
    t = 59_000;
    await store.read();
    expect(fetch).toHaveBeenCalledTimes(2);
    t = 61_000;
    await store.read();
    expect(fetch).toHaveBeenCalledTimes(3);
    const missing = createGearBoardStore({ r2: R2, fetch: (async () => new Response(null, { status: 404 })) as typeof globalThis.fetch });
    expect(await missing.read()).toBeNull();
    const odd = createGearBoardStore({ r2: R2, fetch: (async () => new Response(JSON.stringify({ version: 9 }), { status: 200 })) as typeof globalThis.fetch });
    expect(await odd.read()).toBeNull();
    const down = createGearBoardStore({ r2: R2, fetch: (async () => new Response(null, { status: 500 })) as typeof globalThis.fetch });
    await expect(down.read()).rejects.toThrow();
  });
});

describe("a character's tracked days", () => {
  it("reads its points through the one function, and an error is no chart", async () => {
    const query = vi.fn(async () => [{ day: "2026-11-05", metric: "item_level", value: 52 }, { day: "2026-11-06", metric: "gear_score", value: 50 }]);
    expect(await loadTrack("a", query)).toEqual([
      { day: "2026-11-05", itemLevel: 52, gearScore: null }, { day: "2026-11-06", itemLevel: null, gearScore: 50 },
    ]);
    expect(query).toHaveBeenCalledWith("rpc/character_track_points", expect.objectContaining({ body: JSON.stringify({ p_link_id: "a" }) }));
    expect(await loadTrack("a", async () => { throw new Error("down"); })).toBeNull();
  });
});
