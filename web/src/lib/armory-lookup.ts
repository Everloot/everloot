import { ApiError, ForeverApi, type Region } from "../../../kb/src/armory/api";
import { parseCharacter } from "../../../kb/src/armory/parse";
import { armoryOn, characterSlugOf } from "./armory";
import { armoryStore, type ArmoryHit, type ArmoryStore } from "./armory-store";

/**
 * On-demand armory lookup (#1270): when /search finds no stored character for a full "First Surname", ask the
 * Blizzard Profile API for that slug, US first, then EU, store a hit the way the crawler does, and list it.
 * A lookup makes 1 to 4 Blizzard calls: the profile in each region until one answers, then its equipment and PvP
 * summary, which the stored row needs. It calls a paid-quota API from a public page, so it is held in on every side:
 * - behind EVERLOOT_ARMORY_LOOKUP=1 (and EVERLOOT_ARMORY=1), off by default;
 * - only a full first name and surname that pass the armory form's rules;
 * - only for a browser's own fetch from the /search page, never a crawler or a script that says what it is
 *   (see browserLookup), and never for the header's type-ahead, which would ask on every key;
 * - only regions where the slug is neither hidden nor stored (armory_lookup_regions): a hidden character is never
 *   asked for, and armory_upsert_characters refuses to write one hidden while the lookup ran;
 * - a slug no region knows is kept six hours (armory_lookup_miss) and not asked for again;
 * - each lookup that reaches Blizzard counts against the 'lookup' quota, 20 an hour per address and 300 site-wide;
 * - the whole lookup has LOOKUP_BUDGET_MS. A slow, failed or refused lookup answers null, and the page says "not
 *   found" as before; a failure is not kept as a miss.
 */

/** The whole lookup, storage included; the /search page waits 3 s for its answer. */
export const LOOKUP_BUDGET_MS = 1800;

export function armoryLookupOn(env: Record<string, string | undefined> = process.env): boolean {
  return armoryOn(env) && env.EVERLOOT_ARMORY_LOOKUP === "1";
}

/** The slug of a full "First Surname" that passes the armory form's rules; null for one word, three, or a prefix. */
export function lookupSlug(text: string): string | null {
  const parts = text.trim().split(/\s+/);
  return parts.length === 2 ? characterSlugOf(parts[0]!, parts[1]!) : null;
}

/** Agents that name themselves as tools, crawlers or link previews. */
const NOT_A_PERSON = /bot|crawl|spider|slurp|scrape|preview|headless|lighthouse|python|curl|wget|httpclient|okhttp|axios|node-fetch|undici|go-http|java\/|libwww|monitor/i;

/**
 * True for the /search page's own fetch in a browser: same origin, a fetch rather than a page load, and an agent that
 * does not call itself a crawler or a tool. Not proof of a person (headers can be forged); the quota is the limit,
 * this keeps crawlers that render the page and plain scripts from spending it.
 */
export function browserLookup(req: Request): boolean {
  const h = req.headers;
  const agent = h.get("user-agent") ?? "";
  return h.get("sec-fetch-site") === "same-origin" && h.get("sec-fetch-dest") === "empty" && agent.startsWith("Mozilla/") && !NOT_A_PERSON.test(agent);
}

const REGIONS: readonly Region[] = ["us", "eu"];
const isRegion = (r: string): r is Region => (REGIONS as readonly string[]).includes(r);

export interface LookupDeps {
  store: Pick<ArmoryStore, "lookupRegions" | "lookupMiss" | "storeLookup">;
  /** Counts one lookup against the hourly quota; false when it is used up. Asked only before the first Blizzard call. */
  admit: () => Promise<boolean>;
  api: (region: Region) => Pick<ForeverApi, "get">;
  /** Called when Blizzard refused the client's token, so the next lookup builds a fresh client. */
  forgetApi?: () => void;
  budgetMs?: number;
}

/** A stored character for the full name, read from Blizzard now, or null (see the notes at the top). Never throws. */
export async function lookupCharacter(text: string, deps: LookupDeps): Promise<ArmoryHit | null> {
  const slug = lookupSlug(text);
  if (!slug) return null;
  let late = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => { timer = setTimeout(() => { late = true; resolve(null); }, deps.budgetMs ?? LOOKUP_BUDGET_MS); });
  const run = async (): Promise<ArmoryHit | null> => {
    const regions = (await deps.store.lookupRegions(slug)).filter(isRegion);
    if (!regions.length || late) return null;
    if (!(await deps.admit()) || late) return null;
    const path = `/profile/wow/character/${encodeURIComponent(slug)}`;
    for (const region of regions) {
      const api = deps.api(region);
      const profile = await api.get(path, "profile");
      if (late) return null;
      if (profile.status === 404) continue;
      if (profile.status !== 200) return null;
      const [equipment, pvp] = await Promise.all([api.get(`${path}/equipment`, "profile"), api.get(`${path}/pvp-summary`, "profile")]);
      if (late || equipment.status !== 200 || pvp.status !== 200) return null;
      const row = parseCharacter(profile.body, equipment.body, pvp.body, profile.lastModified, slug);
      if (row.slug !== slug || !(await deps.store.storeLookup(region, row))) return null;
      return { region, slug, name: row.name, surname: row.surname, level: row.level, class: row.class, race: row.race, ruleset: row.ruleset, guildName: row.guild_name };
    }
    if (!late) await deps.store.lookupMiss(slug);
    return null;
  };
  try {
    return await Promise.race([run(), deadline]);
  } catch (err) {
    if (err instanceof ApiError && err.phase === "oauth") deps.forgetApi?.();
    // The reason only: the name someone searched for is not logged.
    console.error(`armory lookup failed: ${err instanceof Error ? err.message.slice(0, 120) : "unknown error"}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const held = globalThis as typeof globalThis & { __everlootLookupApi?: Partial<Record<Region, ForeverApi>>; __everlootLookupLogged?: boolean };

/**
 * The Worker's lookup: the armory store, and one Blizzard client per region kept for the process so its token is
 * reused. The client id and secret are the Battle.net ones the site already reads (BNET_CLIENT_ID and
 * BNET_CLIENT_SECRET, as the crawler does); without them every lookup answers null.
 */
export function findCharacter(text: string, admit: () => Promise<boolean>, env: Record<string, string | undefined> = process.env): Promise<ArmoryHit | null> {
  const clientId = env.BNET_CLIENT_ID?.trim(), clientSecret = env.BNET_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    if (!held.__everlootLookupLogged) { held.__everlootLookupLogged = true; console.error("armory lookup: BNET_CLIENT_ID or BNET_CLIENT_SECRET is not set; lookups answer not found"); }
    return Promise.resolve(null);
  }
  const apis = (held.__everlootLookupApi ??= {});
  // Each call gets its own short timeout in place of the client's 15 s.
  const fetchImpl: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(LOOKUP_BUDGET_MS) });
  return lookupCharacter(text, {
    store: armoryStore(),
    admit,
    api: (region) => (apis[region] ??= new ForeverApi({ clientId, clientSecret, region, fetchImpl })),
    forgetApi: () => { held.__everlootLookupApi = {}; },
  });
}
