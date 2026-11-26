import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container, PageHeader } from "@/components/ui";
import ScreenshotModerationQueue from "@/components/screenshots/ScreenshotModerationQueue";
import { isScreenshotModerator, screenshotQueue, screenshotsOn } from "@/lib/screenshots";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const metadata: Metadata = { title: "Screenshot moderation", robots: { index: false, follow: false, nocache: true } };

/**
 * Player screenshots waiting for review, oldest first, then the ones approved in the last 30 days, for the comment
 * moderators: any account with a row in comment_moderators. Everyone else gets a 404.
 */
export default async function ScreenshotModerationPage() {
  if (!screenshotsOn()) notFound();
  const user = await getUser();
  if (!user || !(await isScreenshotModerator(user.id))) notFound();
  const queue = await screenshotQueue(user.id);
  return (
    <Container>
      <PageHeader title="Screenshot moderation"
        lede="Nothing shows on a page until it is approved here. Approve a player's own game screenshot of the page's subject; reject anything else, and anything showing chat, real names or another player's details. Taking one down removes it from its page." />
      <ScreenshotModerationQueue initial={queue} />
    </Container>
  );
}
