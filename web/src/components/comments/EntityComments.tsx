import { commentsOn } from "@/lib/comments";
import type { CommentEntityType } from "@/lib/comments-shared";
import CommentsSection from "./CommentsSection";

/**
 * The comments at the bottom of an entity page, by (type, id). Nothing at all unless EVERLOOT_COMMENTS=1 (with
 * profiles on). The page's HTML holds only the empty section; the comments and the viewer load in the browser.
 */
export default function EntityComments({ type, id }: { type: CommentEntityType; id: number }) {
  return commentsOn() ? <CommentsSection type={type} id={id} /> : null;
}
