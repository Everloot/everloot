import { validId } from "@/lib/saved-builds";
import { fail, imageResponse, publicKey, screenshotAccess, screenshotBindings, screenshotsOn, unavailable } from "@/lib/screenshots";

/**
 * GET /screenshots/file/<id>: an approved screenshot's WebP, the same for everyone. It reads no session (the edge
 * drops cookies on this path, lib/cf-edge-cache.ts), so the browser and the edge keep it for an hour. Anything the
 * database does not call approved (pending, rejected, deleted, gone with its account) is a 404, whatever the bucket holds.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!screenshotsOn()) return fail(404, "Not found");
  const { id } = await ctx.params;
  if (!validId(id)) return fail(404, "Not found");
  try {
    const bindings = screenshotBindings();
    if (!bindings) return unavailable();
    if ((await screenshotAccess(id, null)) !== "public") return fail(404, "Not found");
    const object = await bindings.bucket.get(publicKey(id));
    return object ? imageResponse(await object.arrayBuffer(), true) : fail(404, "Not found");
  } catch {
    return unavailable();
  }
}
