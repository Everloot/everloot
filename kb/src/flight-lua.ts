/**
 * The addon's flight lengths (addon/modules/flight_data.lua), from the taxi tables: every direct flight between two
 * flight masters on the world map's continents, each way, measured through all of its TaxiPathNode points in three
 * dimensions. The addon sums the hops of a route and divides by its flight speed; yards, not seconds, so the speed
 * can be tuned without regenerating the table.
 */
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { NOT_A_FLIGHT_MASTER } from "./world-map-data.js";

type Rows = Map<number, Record<string, unknown>>;
export type FlightLengths = { nodes: { id: number; name: string }[]; paths: { from: number; to: number; yards: number }[] };

const xyz = (v: unknown): [number, number, number] | null =>
  Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((n) => typeof n === "number" && Number.isFinite(n)) ? [v[0], v[1], v[2]] : null;

export function flightLengths(nodes: Rows, paths: Rows, pathNodes: Rows, continentIds: Set<number>): FlightLengths {
  const names = new Map<number, { name: string; continentId: number }>();
  for (const n of nodes.values()) {
    const name = typeof n.Name_lang === "string" ? n.Name_lang.trim() : "";
    if (name && !NOT_A_FLIGHT_MASTER.test(name) && continentIds.has(Number(n.ContinentID))) names.set(Number(n.ID), { name, continentId: Number(n.ContinentID) });
  }
  const byPath = new Map<number, { index: number; continentId: number; at: [number, number, number] }[]>();
  for (const q of pathNodes.values()) {
    const at = xyz(q.Loc);
    if (!at) continue;
    const list = byPath.get(Number(q.PathID)) ?? [];
    list.push({ index: Number(q.NodeIndex), continentId: Number(q.ContinentID), at });
    byPath.set(Number(q.PathID), list);
  }
  const out: FlightLengths["paths"] = [];
  const seen = new Set<string>();
  for (const p of [...paths.values()].sort((a, b) => Number(a.ID) - Number(b.ID))) {
    const from = Number(p.FromTaxiNode), to = Number(p.ToTaxiNode), a = names.get(from), b = names.get(to);
    const line = byPath.get(Number(p.ID))?.sort((x, y) => x.index - y.index);
    if (!a || !b || a.continentId !== b.continentId || !line || line.length < 2 || seen.has(`${from}-${to}`)) continue;
    let yards = 0;
    // A path that leaves the continent (a ship or a portal on the way) has no flying distance across the gap.
    for (let i = 1; i < line.length; i++) {
      if (line[i]!.continentId !== line[i - 1]!.continentId) continue;
      const [x0, y0, z0] = line[i - 1]!.at, [x1, y1, z1] = line[i]!.at;
      yards += Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    }
    seen.add(`${from}-${to}`);
    out.push({ from, to, yards: Math.round(yards) });
  }
  const used = new Set(out.flatMap((p) => [p.from, p.to]));
  return {
    nodes: [...names].filter(([id]) => used.has(id)).map(([id, n]) => ({ id, name: n.name })).sort((x, y) => x.id - y.id),
    paths: out.sort((x, y) => x.from - y.from || x.to - y.to),
  };
}

const quote = (s: string) => JSON.stringify(s);

export function flightLua(version: string, data: FlightLengths): string {
  return `-- Forever flight paths from the game files (build ${version}); lengths in yards, found in game files, unconfirmed.\n`
    + "-- Regenerated with the game data on every client build (kb/src/flight-lua.ts).\n"
    + "local E = Everloot\nE.FLIGHT_NODES = {\n"
    + data.nodes.map((n) => `  [${n.id}] = ${quote(n.name)},`).join("\n")
    + "\n}\nE.FLIGHT_YARDS = {\n"
    + data.paths.map((p) => `  [${quote(`${p.from}-${p.to}`)}] = ${p.yards},`).join("\n") + "\n}\n";
}

/** The Lua file for a snapshot; empty tables when the snapshot lacks a taxi table. */
export function snapshotFlightLua(snapshotPath: string, continentIds: Set<number>): string {
  const present = new Set(readClientTables(snapshotPath));
  const get = (t: string): Rows => (present.has(t) ? readClientRows(snapshotPath, t) : new Map());
  return flightLua(readClientMeta(snapshotPath).version, flightLengths(get("TaxiNodes"), get("TaxiPath"), get("TaxiPathNode"), continentIds));
}
