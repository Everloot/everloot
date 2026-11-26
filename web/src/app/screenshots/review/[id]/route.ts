import { validId } from "@/lib/saved-builds";
import { fail, imageResponse, pendingKey, publicKey, screenshotAccess, screenshotBindings, screenshotsOn, unavailable } from "@/lib/screenshots";
import { getUser } from "@/lib/supabase/server";

/**
 * GET /screenshots/review/<id>: a screenshot waiting for review, for its uploader and the moderators only, never cached.
 * Everyone else, signed out included, gets a 404.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!screenshotsOn()) return fail(404, "Not found");
  const { id } = await ctx.params;
  if (!validId(id)) return fail(404, "Not found");
  try {
    const user = await getUser();
    if (!user) return fail(404, "Not found");
    const bindings = screenshotBindings();
    if (!bindings) return unavailable();
    const access = await screenshotAccess(id, user.id);
    if (!access) return fail(404, "Not found");
    const object = await bindings.bucket.get(access === "review" ? pendingKey(id) : publicKey(id));
    return object ? imageResponse(await object.arrayBuffer(), false) : fail(404, "Not found");
  } catch {
    return unavailable();
  }
}
