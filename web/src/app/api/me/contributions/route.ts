import { listLinks } from "@/lib/character-links-store";
import { attributeUploads, attributionOn, revokeAttribution } from "@/lib/ops/attribution";
import { getUser, siteUrl } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

export async function GET() {
  try {
    if (!attributionOn()) return fail(404, "Not found");
    const user = await getUser();
    if (!user) return fail(401, "Sign in to choose a contribution character.");
    const links = (await listLinks(user.id)).filter(link => link.status === "linked" && link.page?.public)
      .map(({ id, name, realm }) => ({ id, name, realm }));
    return Response.json({ userId: user.id, links }, { headers });
  } catch { return fail(503, "Contribution choices unavailable."); }
}

async function write(req: Request, revoke: boolean) {
  try {
    if (!revoke && !attributionOn()) return fail(404, "Not found");
    if (req.headers.get("origin") !== siteUrl()) return fail(403, "Invalid origin");
    // A public/desktop key is not authority to opt a browser upload into identity disclosure.
    if (req.headers.has("authorization")) return fail(403, "Use your signed-in browser account.");
    const user = await getUser();
    if (!user) return fail(401, "Sign in to choose a contribution character.");
    const text = await req.text();
    if (text.length > 32_000) return fail(400, "Contribution choice is too large.");
    let value: unknown;
    try { value = JSON.parse(text); } catch { return fail(400, "Invalid contribution choice."); }
    if ((value as { expectedUserId?: unknown } | null)?.expectedUserId !== user.id) return fail(409, "Your active account changed. Reload contribution choices.");
    if (revoke) {
      await revokeAttribution(user.id);
      return Response.json({ ok: true }, { headers });
    }
    const result = await attributeUploads(user.id, value);
    if (!result.ok) return fail(400, "Choose your own public, linked character with a matching key in this file.");
    return Response.json({ ok: true }, { headers });
  } catch { return fail(503, "Contribution choices unavailable."); }
}
export async function POST(req: Request) { return write(req, false); }
export async function DELETE(req: Request) { return write(req, true); }
