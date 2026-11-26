/**
 * What the screenshots section, the moderators' page and the server share: limits, routes and the shapes a page reads.
 * No server code, so the browser bundle can import it. Screenshots go on the same pages as comments.
 */
import type { CommentEntityType } from "./comments-shared";

export { COMMENT_TYPES as SCREENSHOT_TYPES, isCommentType as isScreenshotType, commentEntityHref as screenshotEntityHref } from "./comments-shared";
export type ScreenshotEntityType = CommentEntityType;

/**
 * The database holds the same numbers (20261125140000_entity_screenshots.sql). `fileBytes` is the most a player may
 * send; `storedBytes` and `maxSide` bound the WebP the server keeps; `maxPixels` refuses a picture too large to decode
 * safely before it is re-encoded.
 */
export const SCREENSHOT_LIMITS = {
  fileBytes: 8 * 1024 * 1024, storedBytes: 2_000_000, maxSide: 1920, maxPixels: 40_000_000,
  perDay: 5, pending: 10, sitePerDay: 300,
} as const;
export const SCREENSHOT_ACCEPT = "image/png,image/jpeg,image/webp";

export const SCREENSHOT_STATUSES = ["pending", "approved", "rejected", "deleted"] as const;
export type ScreenshotStatus = (typeof SCREENSHOT_STATUSES)[number];

/** An approved screenshot as the gallery shows it. The same for every visitor. */
export interface GalleryScreenshot { id: string; author: string | null; width: number; height: number; approvedAt: string }
/** The uploader's own screenshot on a page, any status but deleted. */
export interface OwnScreenshot { id: string; status: Exclude<ScreenshotStatus, "deleted">; width: number; height: number; createdAt: string }
export interface ScreenshotViewer { id: string; handle: string | null }
export interface OwnScreenshotsView { viewer: ScreenshotViewer | null; mine: OwnScreenshot[] }

/** A screenshot in the moderators' queue. */
export interface QueuedScreenshot {
  id: string;
  entityType: ScreenshotEntityType;
  entityId: number;
  author: string | null;
  status: "pending" | "approved";
  width: number;
  height: number;
  bytes: number;
  createdAt: string;
  moderatedAt: string | null;
}

/**
 * Where the section and the moderators' page send their requests. Outside /ops and /api/ops on purpose, like comments:
 * the middleware answers a browser fetch to those paths with a plain page-load notice, never the route.
 */
export const SCREENSHOTS_ROUTE = "/screenshots";
export const OWN_SCREENSHOTS_ROUTE = "/screenshots/mine";
export const SCREENSHOT_MODERATION_ROUTE = "/screenshots/moderate";
/** An approved file, the same for everyone and cached. */
export const screenshotFileHref = (id: string) => `/screenshots/file/${id}`;
/** A file waiting for review, for its uploader and the moderators only, never cached. */
export const screenshotReviewHref = (id: string) => `/screenshots/review/${id}`;

export const SCREENSHOT_MODERATION_ACTIONS = ["approve", "reject"] as const;
export type ScreenshotModerationAction = (typeof SCREENSHOT_MODERATION_ACTIONS)[number];
