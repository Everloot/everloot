import { CENSUS_CLASSES, CENSUS_RACES } from "@kb/census";
import { ARMORY_RULESETS, armoryNameQuery } from "./armory";
import type { ArmoryDirectoryFilter } from "./armory-store";

export type PlayerSearchParams = Record<string, string | string[] | undefined>;
export const PLAYER_DIRECTORY_PAGE = 25;
export const PLAYER_SORTS = [
  { slug: "gear-score", value: "gear_score", label: "Gear score" },
  { slug: "item-level", value: "item_level", label: "Item level" },
  { slug: "level", value: "level", label: "Level" },
  { slug: "name", value: "name", label: "Name" },
  { slug: "last-read", value: "fetched_at", label: "Last read" },
] as const;
export const firstParam = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v;
export type PlayerDirectoryQuery = ArmoryDirectoryFilter & { q: string; page: number };

/** Parse once for the form, store and pagination. An invalid nonempty name matches nothing. */
export function playerDirectoryQuery(params: PlayerSearchParams): PlayerDirectoryQuery {
  const get = (key: string) => (firstParam(params[key]) ?? "").trim().normalize("NFC");
  const choice = (value: string, choices: readonly string[]) => choices.find((c) => c.toLowerCase() === value.toLowerCase()) ?? null;
  const level = (v: string) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 60 ? Number(v) : null;
  const q = get("q").slice(0, 40);
  const page = /^[1-9]\d{0,5}$/.test(get("page")) ? Number(get("page")) : 1;
  const cls = CENSUS_CLASSES.find((c) => c.token === get("class").toUpperCase() || c.name.toLowerCase() === get("class").toLowerCase());
  return {
    q, prefix: q ? armoryNameQuery(q) ?? (/^\p{L}$/u.test(q) ? q.toLowerCase() : q) : null,
    class: cls?.name ?? null, race: choice(get("race"), CENSUS_RACES.map((r) => r.name)),
    faction: choice(get("faction"), ["Alliance", "Horde"]), region: choice(get("region"), ["us", "eu"]),
    rulesetId: ARMORY_RULESETS.find((r) => String(r.id) === get("ruleset"))?.id ?? null,
    minLevel: level(get("min")), maxLevel: level(get("max")), guildPrefix: get("guild").slice(0, 80) || null,
    sort: PLAYER_SORTS.find((s) => s.slug === get("sort"))?.value ?? "gear_score",
    limit: PLAYER_DIRECTORY_PAGE, offset: (page - 1) * PLAYER_DIRECTORY_PAGE, page,
  };
}

export function playerDirectoryHref(q: PlayerDirectoryQuery, page: number): string {
  const p = new URLSearchParams();
  const values = {
    q: q.q, class: CENSUS_CLASSES.find((c) => c.name === q.class)?.token, race: q.race, faction: q.faction,
    region: q.region, ruleset: q.rulesetId, min: q.minLevel, max: q.maxLevel, guild: q.guildPrefix,
    sort: PLAYER_SORTS.find((s) => s.value === q.sort)?.slug, page,
  };
  for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined && value !== "") p.set(key, String(value));
  return `/players?${p}`;
}
