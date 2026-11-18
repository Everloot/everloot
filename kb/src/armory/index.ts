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
  // Blizzard allows 36,000 requests an hour per client. One client serves, each hour: this crawl for us and eu
  // (12,000 each, 24,000), the auction refresh (at most 100 per region, 200) and Battle.net sign-in. That leaves
  // about 11,800 (a third) for sign-ins and on-demand lookups. At 50 calls a second a full run takes 4 minutes.
  const budget = Number(flags.get("budget") ?? 12_000);
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
      spiderGuilds: noWrite,
      recordRun: noWrite,
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
  await runCrawl({ region, budget, api, store, dryRun, details: true, log: console.log });
}
