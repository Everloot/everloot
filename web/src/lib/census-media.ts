import { unstable_cache } from "next/cache";
import { ForeverApi } from "@kb/armory/api";

export type CensusIcons = Record<string, string>;
/** Blizzard playable ids. Skyborne has no confirmed media id: keep its name alone. */
export const CENSUS_MEDIA = {
  WARRIOR: ["class", 1], PALADIN: ["class", 2], HUNTER: ["class", 3], ROGUE: ["class", 4], PRIEST: ["class", 5],
  SHAMAN: ["class", 7], MAGE: ["class", 8], WARLOCK: ["class", 9], DRUID: ["class", 11],
  Human: ["race", 1], Orc: ["race", 2], Dwarf: ["race", 3], NightElf: ["race", 4], Scourge: ["race", 5], Tauren: ["race", 6], Gnome: ["race", 7], Troll: ["race", 8],
} as const;

export async function readCensusIcons(api: Pick<ForeverApi, "get">): Promise<CensusIcons> {
  const entries = await Promise.all(Object.entries(CENSUS_MEDIA).map(async ([token, [kind, id]]) => {
    try {
      const response = await api.get(`/data/wow/media/playable-${kind}/${id}`, "static");
      const body = response.body as { assets?: { key: string; value: string }[] } | null;
      const raw = body?.assets?.find((a) => a.key === "icon")?.value;
      if (response.status !== 200 || !raw) return [];
      const url = new URL(raw);
      return url.protocol === "https:" && url.hostname === "render.worldofwarcraft.com" && !url.username && !url.password && !url.port ? [[token, url.href]] : [];
    } catch { return []; }
  }));
  return Object.fromEntries(entries.flat());
}

const cachedIcons = unstable_cache(async () => readCensusIcons(new ForeverApi({
  clientId: process.env.BNET_CLIENT_ID!.trim(), clientSecret: process.env.BNET_CLIENT_SECRET!.trim(), region: "us",
  // Optional art must not hold the census through the client's longer crawl timeout.
  fetchImpl: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(2500) }),
})), ["census-playable-media"], { revalidate: 86400 });

/** Credentials never leave the server; a missing configuration makes no network or cache call. */
export async function censusIcons(): Promise<CensusIcons> {
  if (!process.env.BNET_CLIENT_ID?.trim() || !process.env.BNET_CLIENT_SECRET?.trim()) return {};
  try { return await cachedIcons(); } catch { return {}; }
}
