import { ForeverApi } from "../armory/api.js";
import { runAuctions } from "./job.js";
import { AuctionStore, type JobStore } from "./store.js";

/** `kb blizzard-auctions --region us|eu [--budget N] [--dry-run]`: one pass; --dry-run reads Blizzard and writes nothing. */
export async function blizzardAuctions(flags: Map<string, string>): Promise<void> {
  const region = flags.get("region");
  if (region !== "us" && region !== "eu") throw Error("--region must be us or eu");
  if (flags.has("budget") && !flags.get("budget")?.trim()) throw Error("--budget requires a value");
  const budget = Number(flags.get("budget") ?? 100);
  if (!Number.isSafeInteger(budget) || budget < 0) throw Error("--budget must be a nonnegative integer");
  const required = (key: string) => {
    const value = process.env[key]?.trim();
    if (!value) throw Error(`Missing ${key}`);
    return value;
  };
  const api = new ForeverApi({ region, clientId: required("BNET_CLIENT_ID"), clientSecret: required("BNET_CLIENT_SECRET") });
  const store: JobStore = flags.has("dry-run")
    ? { put: async (_region, _house, rows) => rows.length, purge: async () => 0 }
    : new AuctionStore({ url: required("SUPABASE_URL"), serviceKey: required("SUPABASE_SERVICE_ROLE_KEY") });
  await runAuctions({ region, budget, api, store, log: console.log });
}
