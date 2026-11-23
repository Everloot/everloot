import { NextResponse } from "next/server";
import { z } from "zod";
import { armoryOn, characterFromArmoryUrl, validArmorySlug } from "@/lib/armory";
import { fail, linkAccount, linkSession, NO_STORE, unavailable } from "@/lib/character-links-store";
import { authQuery } from "@/lib/supabase/server";
import { dungeonProgressOn } from "@/lib/boss-kill-sync";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };
const idRule = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const match = z.object({ region: z.enum(["us", "eu"]), slug: z.string().refine(validArmorySlug) });
const candidates = z.array(match.extend({ surname: z.string() })).max(20);

export async function GET(_req: Request, props: Props) {
  if (!armoryOn()) return fail(404, "Not found");
  try {
    const user = await linkSession();
    if (user instanceof Response) return user;
    const { id } = await props.params;
    if (!idRule.test(id)) return fail(400, "Invalid character");
    if (!dungeonProgressOn()) return NextResponse.json({ matches: null }, { headers: NO_STORE });
    const rows = candidates.parse(await authQuery("rpc/armory_match_candidates", {
      method: "POST", body: JSON.stringify({ p_user_id: user, p_link_id: id }),
    }));
    return NextResponse.json({ matches: rows }, { headers: NO_STORE });
  } catch { return unavailable(); }
}

export async function POST(req: Request, props: Props) {
  if (!armoryOn()) return fail(404, "Not found");
  try {
    const user = await linkAccount(req, false);
    if (user instanceof Response) return user;
    const { id } = await props.params;
    if (!idRule.test(id)) return fail(400, "Invalid character");
    const body = await req.json().catch(() => null);
    const proposed = match.safeParse(body?.match);
    const identity = proposed.success ? proposed.data : typeof body?.armoryUrl === "string" ? characterFromArmoryUrl(body.armoryUrl) : null;
    if (!identity && body?.armoryUrl !== null) return fail(400, "Choose a Blizzard Forever character.");
    const linked = await authQuery<boolean>("rpc/armory_associate", { method: "POST", body: JSON.stringify({ p_user_id: user, p_link_id: id, p_region: identity?.region ?? null, p_slug: identity?.slug ?? null }) });
    if (linked !== true) return fail(409, "Could not connect this profile. Add it to the armory first and check that its name, race, class, faction and ruleset match your linked character.");
    return NextResponse.json({ linked: identity !== null }, { headers: NO_STORE });
  } catch { return unavailable(); }
}
