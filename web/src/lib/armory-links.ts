import { z } from "zod";
import { armoryCharacterPath } from "./armory";
import { characterPath, showcaseOn } from "./character-showcase";
import { privateSyncOn } from "./private-sync";
import { publicCharacterFacts } from "./private-sync-store";
import { authQuery } from "./supabase/server";

export async function ownArmoryLinks(userId: string): Promise<Map<string, string>> {
  const rows = await authQuery<unknown>("rpc/armory_own_links", { method: "POST", body: JSON.stringify({ p_user_id: userId }) });
  return new Map(z.array(z.object({ link_id: z.string().uuid(), region: z.enum(["us", "eu"]), slug: z.string() })).parse(rows)
    .map((r) => [r.link_id, armoryCharacterPath(r.region, r.slug)]));
}

/** The database repeats public-page, suppression and frozen-link checks on every read. */
export async function publicArmoryLink(region: string, slug: string): Promise<{ path: string; sharesData: boolean; identity: { ruleset: string; realm: string; name: string } } | null> {
  if (!showcaseOn()) return null;
  const rows = await authQuery<unknown>("rpc/armory_public_link", { method: "POST", body: JSON.stringify({ p_region: region, p_slug: slug }) });
  const row = z.array(z.object({ ruleset: z.string(), realm: z.string(), name: z.string() })).parse(rows)[0];
  if (!row) return null;
  const path = characterPath(row.ruleset, row.realm, row.name);
  const facts = privateSyncOn() ? await publicCharacterFacts(row.ruleset, row.realm, row.name).catch(() => []) : [];
  return { path, sharesData: facts.length > 0, identity: row };
}
