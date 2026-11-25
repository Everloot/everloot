/**
 * GET /database/card/<type>/<id>: the hover card's old path, kept for pages and scripts cached before it moved to
 * /api/card (app/api/card/[type]/[id]). The same handler, so the same card, headers and credential-free edge cache.
 */
export const dynamic = "force-dynamic";

export { GET } from "@/app/api/card/[type]/[id]/route";
