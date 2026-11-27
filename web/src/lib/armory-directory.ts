import { CENSUS_CLASSES } from "@kb/census";
import { ARMORY_RACES, ARMORY_RULESETS, armoryNameQuery } from "./armory";
import type { ArmoryDirectoryFilter } from "./armory-store";
import { parsePer, PER_PAGE } from "./page-size";

export type PlayerSearchParams = Record<string, string | string[] | undefined>;
export const PLAYER_SORTS = [
  { slug: "gear-score", value: "gear_score", label: "Gear score" },
  { slug: "item-level", value: "item_level", label: "Item level" },
  { slug: "level", value: "level", label: "Level" },
  { slug: "name", value: "name", label: "Name" },
  { slug: "last-read", value: "fetched_at", label: "Last read" },
] as const;
export const firstParam = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v;
/** `per` is the ?per= size when it is not the default (lib/page-size.ts); the store's own cap is 100. */
export type PlayerDirectoryQuery = ArmoryDirectoryFilter & { q: string; page: number; per?: number };

/** The level menu's choices; a range typed into the address that is none of them shows as its own choice. */
export const PLAYER_LEVEL_BANDS = [
  { label: "60", min: 60, max: 60 }, { label: "50–59", min: 50, max: 59 }, { label: "40–49", min: 40, max: 49 },
  { label: "30–39", min: 30, max: 39 }, { label: "20–29", min: 20, max: 29 }, { label: "10–19", min: 10, max: 19 }, { label: "1–9", min: 1, max: 9 },
] as const;

export const levelBandOf = (q: Pick<PlayerDirectoryQuery, "minLevel" | "maxLevel">) =>
  PLAYER_LEVEL_BANDS.find((b) => b.min === q.minLevel && b.max === q.maxLevel) ?? null;

/** How many filters are on, for the bar's "Clear filters": the level range counts once, the name box and the default sort not at all. */
export const activeDirectoryFilters = (q: PlayerDirectoryQuery) =>
  [q.class, q.race, q.faction, q.region, q.rulesetId, q.guildPrefix].filter((v) => v !== null).length
  + (q.minLevel !== null || q.maxLevel !== null ? 1 : 0) + (q.sort === "gear_score" ? 0 : 1);

/** Parse once for the form, store and pagination. An invalid nonempty name matches nothing. */
export function playerDirectoryQuery(params: PlayerSearchParams): PlayerDirectoryQuery {
  const get = (key: string) => (firstParam(params[key]) ?? "").trim().normalize("NFC");
  const choice = (value: string, choices: readonly string[]) => choices.find((c) => c.toLowerCase() === value.toLowerCase()) ?? null;
  const level = (v: string) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 60 ? Number(v) : null;
  const q = get("q").slice(0, 40);
  const page = /^[1-9]\d{0,5}$/.test(get("page")) ? Number(get("page")) : 1;
  const per = parsePer(get("per") || undefined) ?? undefined;
  const limit = per ?? PER_PAGE;
  const cls = CENSUS_CLASSES.find((c) => c.token === get("class").toUpperCase() || c.name.toLowerCase() === get("class").toLowerCase());
  return {
    q, prefix: q ? armoryNameQuery(q) ?? (/^\p{L}$/u.test(q) ? q.toLowerCase() : q) : null,
    class: cls?.name ?? null, race: choice(get("race"), ARMORY_RACES),
    faction: choice(get("faction"), ["Alliance", "Horde"]), region: choice(get("region"), ["us", "eu"]),
    rulesetId: ARMORY_RULESETS.find((r) => String(r.id) === get("ruleset"))?.id ?? null,
    minLevel: level(get("min")), maxLevel: level(get("max")), guildPrefix: get("guild").slice(0, 80) || null,
    sort: PLAYER_SORTS.find((s) => s.slug === get("sort"))?.value ?? "gear_score",
    limit, offset: (page - 1) * limit, page, per,
  };
}

export function playerDirectoryHref(q: PlayerDirectoryQuery, page: number): string {
  const p = new URLSearchParams();
  const values = {
    q: q.q, class: CENSUS_CLASSES.find((c) => c.name === q.class)?.token, race: q.race, faction: q.faction,
    region: q.region, ruleset: q.rulesetId, min: q.minLevel, max: q.maxLevel, guild: q.guildPrefix,
    sort: q.sort === "gear_score" ? undefined : PLAYER_SORTS.find((s) => s.value === q.sort)?.slug, per: q.per, page: page > 1 ? page : undefined,
  };
  for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined && value !== "") p.set(key, String(value));
  const query = p.toString();
  return query ? `/players?${query}` : "/players";
}
