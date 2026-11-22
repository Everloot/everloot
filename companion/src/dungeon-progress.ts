import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { luaString } from "./bridge/lua";

const ADDON = "EverlootProgress";
const PAGE = 200;
const MAX_ROWS = 20_000;
const MAX_AGE = 7200;
const playerName = /^\p{L}{2,24}$/u;

interface Snapshot {
  catalog: string;
  total: number;
  expiresAt: number;
  next: number | null;
  rows: Array<[string, string, number]>;
}

const realmKey = (realm: string) => realm.toLowerCase().replace(/’/g, "'").replace(/[\s-]+/g, " ").trim();

function parsePage(raw: unknown, offset: number, now: number): Snapshot {
  const page = raw as Partial<Snapshot> | null;
  if (!page || typeof page.catalog !== "string" || !/^[\w.:/-]{1,96}$/.test(page.catalog) ||
    typeof page.total !== "number" || !Number.isInteger(page.total) || page.total < 0 || page.total > 100 ||
    typeof page.expiresAt !== "number" || !Number.isInteger(page.expiresAt) || page.expiresAt <= now || page.expiresAt > now + MAX_AGE + 300 ||
    (page.next !== null && page.next !== offset + PAGE) || !Array.isArray(page.rows) || page.rows.length > PAGE) {
    throw new Error("Invalid dungeon progress snapshot");
  }
  const total = page.total;
  if (page.rows.some((row) => !Array.isArray(row) || row.length !== 3 || typeof row[0] !== "string" || !playerName.test(row[0]) ||
    typeof row[1] !== "string" || !playerName.test(row[1]) || !Number.isInteger(row[2]) || row[2] < 0 || row[2] > total)) {
    throw new Error("Invalid dungeon progress row");
  }
  return page as Snapshot;
}

export async function refreshDungeonProgress(options: {
  realms: string[]; endpoint: string; addonsDir: string; current: () => boolean; fetch?: typeof fetch; now?: () => number;
}) {
  const send = options.fetch ?? fetch;
  const now = () => Math.floor((options.now ?? Date.now)() / 1000);
  const rows: string[] = [];
  for (const realm of new Set(options.realms.map(realmKey))) {
    const seen = new Map<string, number | null>();
    let latest: Snapshot | undefined;
    let expires = Infinity;
    for (let offset: number | null = 0; offset !== null;) {
      if (!options.current()) return;
      const url = new URL("/api/progression/dungeons", options.endpoint);
      url.search = new URLSearchParams({ realm, offset: String(offset) }).toString();
      const response = await send(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
      if (response.status === 404 && offset === 0) break;
      if (!response.ok) throw new Error(`Dungeon progress: HTTP ${response.status}`);
      const page = parsePage(await response.json(), offset, now());
      if (latest && (page.catalog !== latest.catalog || page.total !== latest.total)) throw new Error("The dungeon catalog changed during refresh");
      latest = page;
      expires = Math.min(expires, page.expiresAt);
      for (const [first, last, count] of page.rows) {
        const key = `${first} ${last}`;
        // Identical copies can occur across pages as a character is added. Conflicting copies are ambiguous.
        seen.set(key, seen.has(key) && seen.get(key) !== count ? null : count);
      }
      offset = page.next !== null && page.next < MAX_ROWS ? page.next : null;
    }
    if (!latest?.total) continue;
    const players = [...seen].flatMap(([name, count]) => count === null ? [] : [`[${luaString(name)}]=${count}`]).join(",");
    rows.push(`[${luaString(realm)}]={catalog=${luaString(latest.catalog)},total=${latest.total},expiresAt=${expires},players={${players}}}`);
  }
  if (!options.current()) return;
  const dir = join(options.addonsDir, ADDON);
  mkdirSync(dir, { recursive: true });
  for (const [file, body] of [
    [`${ADDON}.lua`, `EverlootProgressDB = {\n${rows.join(",\n")}\n}\n`],
    [`${ADDON}.toc`, `## Interface: 16001\n## Title: Everloot Progress\n## Notes: Public dungeon progress, refreshed by Everloot Desktop.\n${ADDON}.lua\n`],
  ]) {
    const path = join(dir, file!);
    writeFileSync(`${path}.tmp`, body!);
    renameSync(`${path}.tmp`, path);
  }
}
