import { afterEach, expect, test, vi } from "vitest";
import { trackedDungeons } from "@kb/progression";
import { refreshDungeonProgress } from "../../../../../../companion/src/dungeon-progress";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ authQuery: query }));
import { GET } from "./route";

afterEach(() => { vi.unstubAllEnvs(); query.mockReset(); });
function enable() {
  for (const flag of ["EVERLOOT_ARMORY", "EVERLOOT_PRIVATE_SYNC", "EVERLOOT_CHARACTER_LINKS",
    "EVERLOOT_BOSS_KILL_SYNC", "EVERLOOT_DUNGEON_PROGRESS"]) vi.stubEnv(flag, "1");
  vi.stubEnv("EVERLOOT_DATA_GUARD", "");
}

test("Desktop receives a compact realm snapshot that can replace hidden players", async () => {
  enable();
  const dir = mkdtempSync(join(tmpdir(), "everloot-progress-"));
  try {
    const realm = "Forever-US1 PvE";
    const dungeon = trackedDungeons()[0]!;
    const kills = dungeon.bosses.map(({ id }) => ({ instanceMapId: dungeon.id, encounterId: id }));
    query.mockResolvedValueOnce({ next: 200, rows: [{ name: "Mira", surname: "Dawn", kills, gear: 63 }] });
    query.mockResolvedValueOnce({ next: null, rows: [{ name: "Mira", surname: "Vale", kills: [] }] });
    const options = { realms: [realm], endpoint: "https://everloot.app", addonsDir: dir, current: () => true,
      fetch: (async (url) => GET(new Request(url))) as typeof fetch };
    await refreshDungeonProgress(options);
    const file = join(dir, "EverlootProgress", "EverlootProgress.lua");
    expect(readFileSync(file, "utf8")).toContain('["Mira Dawn"]=1');
    expect(readFileSync(file, "utf8")).toContain('["Mira Vale"]=0');
    expect(readFileSync(file, "utf8")).not.toContain("gear");
    expect(JSON.parse(query.mock.calls[0]![1].body)).toMatchObject({ p_realm: "forever us1 pve", p_offset: 0 });
    expect(JSON.parse(query.mock.calls[1]![1].body)).toMatchObject({ p_offset: 200 });
    query.mockResolvedValueOnce({ next: null, rows: [] });
    await refreshDungeonProgress(options);
    expect(readFileSync(file, "utf8")).not.toContain("Mira");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("invalid realms and disabled publication never call the database", async () => {
  const req = new Request("https://everloot.app/api/progression/dungeons?realm=US+PvE");
  expect((await GET(req)).status).toBe(404);
  enable();
  expect((await GET(new Request("https://everloot.app/api/progression/dungeons?realm=%2F"))).status).toBe(400);
  expect(query).not.toHaveBeenCalled();
});
