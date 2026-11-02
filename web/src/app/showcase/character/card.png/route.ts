import { sampleCard } from "../sample-card";

export const dynamic = "force-dynamic";

/** The sample character's link preview, 1200x630: the page's og:image and twitter:image. */
export function GET() {
  return sampleCard("wide");
}
