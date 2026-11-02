import { sampleShowcase } from "@/data/showcase";
import { buildShowcase, showcaseOn } from "@/lib/character-showcase";
import { renderCharacterCard, type CharacterCardSize } from "@/lib/og-card";

/**
 * The sample character's card at either size, or a 404 with the showcase off. Drawn on each request: the sample's
 * dates move with the day, and the switch is read when the request comes, not when the site is built.
 */
export async function sampleCard(size: CharacterCardSize): Promise<Response> {
  if (!showcaseOn()) return new Response("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex" } });
  const image = await renderCharacterCard(buildShowcase(sampleShowcase(new Date()), new Date()), size);
  image.headers.set("Cache-Control", "public, max-age=3600");
  image.headers.set("X-Robots-Tag", "noindex");
  return image;
}
