import { unstable_cache } from "next/cache";
import { z } from "zod";
import { authQuery } from "./supabase/server";

const Kill = z.object({ encounterId: z.number().int().positive(), instanceMapId: z.number().int().positive(), lastKillAt: z.string().datetime({ offset: true }) });
const History = z.object({ region: z.string(), slug: z.string(), kills: z.array(Kill) });
const GuildHistory = History.extend({ guild_slug: z.string(), guild_name: z.string() });
export type PublicHistory = z.infer<typeof History>;
export type PublicGuildHistory = z.infer<typeof GuildHistory>;
export interface ProgressionStore {
  characters(characters: readonly { region: string; slug: string }[]): Promise<PublicHistory[]>;
  region(region: string | null): Promise<PublicGuildHistory[]>;
}
type Query = <T>(path: string, init?: RequestInit) => Promise<T>;

export function createCloudProgressionStore(query: Query = authQuery): ProgressionStore {
  async function rpc<T>(name: string, body: unknown, schema: z.ZodType<T>) {
    return schema.parse(await query(`rpc/${name}`, { method: "POST", body: JSON.stringify(body) }));
  }
  return {
    characters: (characters) => rpc("public_boss_kills", { p_characters: characters }, z.array(History)),
    region: (region) => rpc("public_boss_kill_characters", { p_region: region }, z.array(GuildHistory)),
  };
}

export function createUnavailableProgressionStore(): ProgressionStore {
  const fail = async (): Promise<never> => { throw new Error("Progression storage is unavailable"); };
  return { characters: fail, region: fail };
}

// Five minutes, like the armory boards. Character and guild hides invalidate these same tags.
const cachedCharacters = unstable_cache(async (characters: { region: string; slug: string }[]) =>
  createCloudProgressionStore().characters(characters), ["public-boss-kills"], { revalidate: 300, tags: ["players", "guilds"] });
const cachedRegion = unstable_cache(async (region: string | null) =>
  createCloudProgressionStore().region(region), ["public-boss-kill-region"], { revalidate: 300, tags: ["players", "guilds"] });

export function progressionStore(env: Record<string, string | undefined> = process.env): ProgressionStore {
  if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return createUnavailableProgressionStore();
  return { characters: (characters) => cachedCharacters([...characters]), region: cachedRegion };
}
