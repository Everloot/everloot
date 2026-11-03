import { characterCard, type Params } from "../character-view";

export const dynamic = "force-dynamic";

/** The character's square card, 1080x1080, for Discord and social posts. A 404 whenever the page is. */
export function GET(_req: Request, { params }: { params: Promise<Params> }) {
  return characterCard(params, "square");
}
