import { ForeverApi } from "./api.js";
import { runCrawl } from "./crawl.js";
import { ArmoryStore, type CrawlStore } from "./store.js";
import { guildSlug } from "../guilds.js";

export { ForeverApi, runCrawl, ArmoryStore };
export async function armoryCrawl(flags: Map<string, string>): Promise<void> {
  const region = flags.get("region");
  if (region !== "us" && region !== "eu")
    throw Error("--region must be us or eu");
  if (flags.has("budget") && !flags.get("budget")?.trim())
    throw Error("--budget requires a value");
  const budget = Number(flags.get("budget") ?? 6000);
  if (!Number.isSafeInteger(budget) || budget < 0)
    throw Error("--budget must be a nonnegative integer");
  const required = (key: string) => {
    const value = process.env[key]?.trim();
    if (!value) throw Error(`Missing ${key}`);
    return value;
  };
  const api = new ForeverApi({
    region,
    clientId: required("BNET_CLIENT_ID"),
    clientSecret: required("BNET_CLIENT_SECRET"),
  });
  const dryRun = flags.has("dry-run");
  let store: CrawlStore;
  if (dryRun) {
    // Read one caller-selected guild in memory, even without database credentials.
    const seed = guildSlug(required("ARMORY_DRY_RUN_GUILD"));
    const noWrite = async (): Promise<never> => {
      throw Error("Dry-run attempted a write");
    };
    store = {
      take: async (_region, kind, limit) =>
        kind === "guild" && limit > 0
          ? [{ slug: seed, stored: false, tries: 0 }]
          : [],
      character: async () => [],
      guild: async () => [],
      seedFromPlayers: noWrite,
      upsertCharacters: noWrite,
      upsertGuild: noWrite,
      touch: noWrite,
      missing: noWrite,
      retry: noWrite,
      purge: noWrite,
    };
  } else {
    store = new ArmoryStore({
      url: required("SUPABASE_URL"),
      serviceKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    });
  }
  await runCrawl({ region, budget, api, store, dryRun, log: console.log });
}
