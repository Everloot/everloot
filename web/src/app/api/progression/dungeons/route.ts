import { z } from "zod";
import { validRealm } from "@everloot/protocol";
import { DUNGEON_PROGRESS_CATALOG, dungeonProgress, trackedDungeons } from "@kb/progression";
import { armoryOn, NAME_RULE, SURNAME_RULE } from "@/lib/armory";
import { bossKillSyncOn } from "@/lib/boss-kill-sync";
import { linkRealmKey } from "@/lib/character-links";
import { admit } from "@/lib/data-guard";
import { authQuery } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 200;
const MAX_OFFSET = 19_800;
const Page = z.object({
  next: z.number().int().nullable(),
  rows: z.array(z.object({
    name: z.string(), surname: z.string(),
    kills: z.array(z.object({ encounterId: z.number().int().positive(), instanceMapId: z.number().int().positive() })),
  })).max(PAGE_SIZE),
});
const headers = { "Cache-Control": "no-store" };
const maps = trackedDungeons().map((row) => row.id);

/** Desktop reads only one realm's public addon summaries. No Blizzard API fields are returned. */
export async function GET(request: Request) {
  if (!armoryOn() || !bossKillSyncOn() || process.env.EVERLOOT_DUNGEON_PROGRESS !== "1") {
    return Response.json({ error: "Dungeon summaries are unavailable" }, { status: 404, headers });
  }
  const params = new URL(request.url).searchParams;
  const realm = params.get("realm") ?? "";
  const offset = Number(params.get("offset") ?? "0");
  if (!validRealm(realm) || !Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET || offset % PAGE_SIZE !== 0) {
    return Response.json({ error: "Invalid realm or offset" }, { status: 400, headers });
  }
  const admitted = await admit(request, "corpus");
  if (admitted instanceof Response) return admitted;
  try {
    const page = Page.parse(await authQuery("rpc/dungeon_progress_page", {
      method: "POST", body: JSON.stringify({ p_realm: linkRealmKey(realm), p_offset: offset, p_maps: maps }),
    }));
    const rows = page.rows.flatMap(({ name, surname, kills }) => {
      const progress = dungeonProgress(kills);
      return progress && NAME_RULE.test(name) && SURNAME_RULE.test(surname) ? [[name, surname, progress.cleared]] : [];
    });
    return Response.json({
      catalog: DUNGEON_PROGRESS_CATALOG,
      total: dungeonProgress([])?.total ?? 0,
      expiresAt: Math.floor(Date.now() / 1000) + 7200,
      next: page.next,
      rows,
    }, { headers });
  } catch {
    return Response.json({ error: "Dungeon summaries are unavailable" }, { status: 503, headers });
  }
}
