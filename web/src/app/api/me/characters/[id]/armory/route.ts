import { NextResponse } from "next/server";
import { armoryOn, characterFromArmoryUrl } from "@/lib/armory";
import { fail, linkAccount, NO_STORE, unavailable } from "@/lib/character-links-store";
import { authQuery } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  if (!armoryOn()) return fail(404, "Not found");
  try {
    const user = await linkAccount(req, false);
    if (user instanceof Response) return user;
    const { id } = await props.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return fail(400, "Invalid character");
    const body = await req.json().catch(() => null);
    if (!body || !(body.armoryUrl === null || typeof body.armoryUrl === "string")) return fail(400, "Enter a Blizzard armory link.");
    const identity = body.armoryUrl === null ? null : characterFromArmoryUrl(body.armoryUrl);
    if (body.armoryUrl !== null && !identity) return fail(400, "Enter a Blizzard Forever character armory link.");
    const linked = await authQuery<boolean>("rpc/armory_associate", { method: "POST", body: JSON.stringify({ p_user_id: user, p_link_id: id, p_region: identity?.region ?? null, p_slug: identity?.slug ?? null }) });
    if (linked !== true) return fail(409, "Could not connect this profile. Add it to the armory first and check that its name, race, class, faction and ruleset match your linked character.");
    return NextResponse.json({ linked: identity !== null }, { headers: NO_STORE });
  } catch { return unavailable(); }
}
