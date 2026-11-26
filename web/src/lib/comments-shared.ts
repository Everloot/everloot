/**
 * What the comments section, the moderators' page and the server share: the pages that take comments, the limits, the
 * report reasons and the shapes a page reads. No server code, so the browser bundle can import it.
 */

export const COMMENT_TYPES = ["item", "quest", "npc", "spell", "zone", "instance"] as const;
export type CommentEntityType = (typeof COMMENT_TYPES)[number];
export const isCommentType = (value: unknown): value is CommentEntityType => COMMENT_TYPES.includes(value as CommentEntityType);

export const REPORT_REASONS = ["spam", "abuse", "spoiler", "off_topic", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  spam: "Spam or advertising", abuse: "Harassment or abuse", spoiler: "Spoiler without a spoiler tag", off_topic: "Off topic", other: "Something else",
};

/** The database holds the same numbers. */
export const COMMENT_LIMITS = { body: 2000, note: 300, postsPerDay: 20, editsPerDay: 30, reportsPerDay: 30, editMinutes: 15 } as const;
export const COMMENT_STATUSES = ["visible", "hidden", "deleted"] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

/** A comment as a page shows it. A hidden or deleted one has no words and no author. */
export interface PageComment {
  id: string;
  author: string | null;
  body: string;
  status: CommentStatus;
  createdAt: string;
  editedAt: string | null;
  mine: boolean;
  editable: boolean;
  reported: boolean;
}
/** The signed-in viewer: their account id, for the expected-owner header, and their handle, or null before they pick one. */
export interface CommentViewer { id: string; handle: string | null }
export interface CommentsView { comments: PageComment[]; viewer: CommentViewer | null }

/** A comment in the moderators' queue. */
export interface QueuedComment {
  id: string;
  entityType: CommentEntityType;
  entityId: number;
  author: string | null;
  body: string;
  status: CommentStatus;
  createdAt: string;
  editedAt: string | null;
  moderatedAt: string | null;
  openReports: number;
  reasons: ReportReason[];
  notes: string[];
}

/** A page's address for an entity; the zone and instance pages redirect a bare id to their full address. */
export function commentEntityHref(type: CommentEntityType, id: number): string {
  const dir = { item: "items", quest: "quests", npc: "npcs", spell: "spells", zone: "zones", instance: "instances" }[type];
  return `/database/${dir}/${id}`;
}

/** Where the comments section and the moderators' page send their requests. Outside /ops and /api/ops on purpose: the
 *  middleware answers a browser fetch to those ad-free paths with a plain page-load notice, never the route. */
export const COMMENTS_ROUTE = "/comments";
export const MODERATION_ROUTE = "/comments/moderate";

export const MODERATION_ACTIONS = ["hide", "restore", "dismiss"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];
