import { characterCard, type Params } from "../character-view";

export const dynamic = "force-dynamic";

/** The character's link preview, 1200x630: the page's og:image and twitter:image. A 404 whenever the page is. */
export function GET(_req: Request, { params }: { params: Promise<Params> }) {
  return characterCard(params, "wide");
}
