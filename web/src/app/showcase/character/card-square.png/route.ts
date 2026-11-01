import { sampleCard } from "../sample-card";

export const dynamic = "force-dynamic";

/** The sample character's square card, 1080x1080, for Discord and social posts. */
export function GET() {
  return sampleCard("square");
}
