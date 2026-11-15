import { buildRecipeCatalog } from "@/lib/recipe-catalog";
/** Exported as a static JSON asset by Next at build time, never a request-time query. */
export const dynamic = "force-static";
export async function GET() {
  return Response.json(await buildRecipeCatalog());
}
