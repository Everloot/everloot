import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container, PageHeader } from "@/components/ui";
import ModerationQueue from "@/components/comments/ModerationQueue";
import { commentsOn, isCommentModerator, moderationQueue } from "@/lib/comments";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const metadata: Metadata = { title: "Comment moderation", robots: { index: false, follow: false, nocache: true } };

/**
 * Comments players reported, and the ones hidden in the last 30 days, for the comment moderators: any account with a
 * row in comment_moderators, which the operator adds by hand. Everyone else gets a 404.
 */
export default async function CommentModerationPage() {
  if (!commentsOn()) notFound();
  const user = await getUser();
  if (!user || !(await isCommentModerator(user.id))) notFound();
  const queue = await moderationQueue(user.id);
  return (
    <Container>
      <PageHeader title="Comment moderation" lede="Reported comments first, then the ones hidden in the last 30 days. Hiding takes a comment's words off its page; restoring puts them back." />
      <ModerationQueue initial={queue} />
    </Container>
  );
}
