import { NextResponse } from "next/server";
import {
  NO_STORE, SCREENSHOT_LIMITS, deleteScreenshot, fail, galleryFor, isScreenshotType, parseScreenshotEntityId, pendingKey, reencodeScreenshot,
  screenshotAccount, screenshotBindings, screenshotsOn, submitScreenshot, unavailable, uploadRefusal, type ReencodeRefusal, type UploadRefusal,
} from "@/lib/screenshots";

/**
 * GET /screenshots?type=<item|quest|npc|spell|zone|instance>&id=<n>: the page's approved screenshots, the same for every
 * visitor. It reads no session, so it is cached for five minutes (browser and edge) and the section asks for it without
 * cookies. POST (multipart: type, id, file, confirm=yes): one upload for the signed-in account, re-encoded and kept
 * for review. Part of the site, not the API: left out of the API docs, the MCP server and search engines, and 404
 * unless EVERLOOT_SCREENSHOTS=1.
 */
export const dynamic = "force-dynamic";

const PUBLIC = { "Cache-Control": "public, max-age=300", "CDN-Cache-Control": "max-age=300", "X-Robots-Tag": "noindex" };
const MB = SCREENSHOT_LIMITS.fileBytes / 1024 / 1024;
/** Room for the form's own fields and boundaries around the file. */
const FORM_OVERHEAD = 64 * 1024;
const FIELDS = new Set(["type", "id", "file", "confirm"]);

const REFUSED: Record<UploadRefusal, [number, string]> = {
  needs_handle: [409, "Choose a handle on your settings page first. A screenshot is credited to your handle, never your BattleTag."],
  too_many_pending: [429, `You have ${SCREENSHOT_LIMITS.pending} screenshots waiting for a moderator. Upload more once they are looked at.`],
  daily_limit: [429, `That is today's limit (${SCREENSHOT_LIMITS.perDay} screenshots a day). Try again tomorrow.`],
  site_limit: [429, "The site has taken all the screenshots it can review today. Try again tomorrow."],
};
const UNUSABLE: Record<ReencodeRefusal, [number, string]> = {
  not_an_image: [415, "That file is not a PNG, JPEG or WebP picture."],
  unreadable: [415, "That picture could not be read. Save it again as PNG or JPEG and retry."],
  too_many_pixels: [413, "That picture is too large. Use one of at most 40 megapixels."],
  too_big: [413, "That picture is still too large once shrunk. Try a smaller one or a JPEG."],
};

export async function GET(req: Request) {
  if (!screenshotsOn()) return fail(404, "Not found");
  const params = new URL(req.url).searchParams;
  const type = params.get("type");
  const id = parseScreenshotEntityId(params.get("id"));
  if (!isScreenshotType(type) || id === null) return fail(400, "Unknown page.");
  try {
    return NextResponse.json({ screenshots: await galleryFor(type, id) }, { headers: PUBLIC });
  } catch {
    return unavailable();
  }
}

export async function POST(req: Request) {
  try {
    const user = await screenshotAccount(req);
    if (user instanceof Response) return user;
    const bindings = screenshotBindings();
    if (!bindings) return unavailable();
    const declared = Number(req.headers.get("content-length"));
    if (!req.headers.has("content-length") || !Number.isFinite(declared)) return fail(411, "Send the file as a form upload.");
    if (declared > SCREENSHOT_LIMITS.fileBytes + FORM_OVERHEAD) return fail(413, `A screenshot can be up to ${MB} MB.`);

    let form: FormData;
    try { form = await req.formData(); } catch { return fail(400, "Send the file as a form upload."); }
    if ([...form.keys()].some((k) => !FIELDS.has(k)) || form.getAll("file").length !== 1) return fail(400, "Send one screenshot and its page.");
    const type = form.get("type");
    const id = parseScreenshotEntityId(form.get("id"));
    const file = form.get("file");
    if (!isScreenshotType(type) || id === null) return fail(400, "Unknown page.");
    if (form.get("confirm") !== "yes") return fail(400, "Confirm the screenshot is your own and that Everloot may show it.");
    if (!(file instanceof Blob)) return fail(400, "Choose a screenshot.");
    if (file.size === 0) return fail(400, "That file is empty.");
    if (file.size > SCREENSHOT_LIMITS.fileBytes) return fail(413, `A screenshot can be up to ${MB} MB.`);

    // Refusals before the re-encode, so an account at its limit spends nothing.
    const refused = await uploadRefusal(user.id);
    if (refused) return refusal(refused);
    const result = await reencodeScreenshot(new Uint8Array(await file.arrayBuffer()), bindings.images);
    if (!result.ok) return fail(...UNUSABLE[result.refused]);

    const submitted = await submitScreenshot(user.id, type, id, { width: result.width, height: result.height, bytes: result.bytes.length });
    if ("refused" in submitted) return refusal(submitted.refused);
    try {
      await bindings.bucket.put(pendingKey(submitted.screenshotId), result.bytes, { httpMetadata: { contentType: "image/webp" } });
    } catch {
      // No file, no entry: the row is taken back so moderators never see an empty one.
      await deleteScreenshot(user.id, submitted.screenshotId).catch(() => null);
      return unavailable();
    }
    return NextResponse.json({ screenshotId: submitted.screenshotId }, { status: 201, headers: NO_STORE });
  } catch {
    return unavailable();
  }
}

function refusal(refused: UploadRefusal) {
  const [status, error] = REFUSED[refused];
  return refused === "needs_handle" ? NextResponse.json({ error, settings: "/settings" }, { status, headers: NO_STORE }) : fail(status, error);
}
