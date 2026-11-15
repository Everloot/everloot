import { CLIENT_PROFESSIONS } from "@/lib/professions";
import { buildRecipeCatalog } from "@/lib/recipe-catalog";
export const dynamic = "force-static";
export const dynamicParams = false;
export function generateStaticParams() {
  return CLIENT_PROFESSIONS.map(p=>({profession:p.slug}));
}
export async function GET(_request: Request, {params}: {params: Promise<{profession:string}>}) {
  const {profession}=await params;
  const catalog=buildRecipeCatalog();
  return Response.json({...catalog,recipes:catalog.recipes.filter(r=>r.slug===profession)});
}
