import type { Metadata } from "next";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://everloot.app").replace(/\/$/, "");
export const SITE_NAME = "Everloot";

export const absoluteUrl = (path: string): string => (/^https?:\/\//.test(path) ? path : `${SITE_URL}${path === "/" ? "" : path}`);

export const DESCRIPTION_MIN = 120;
export const DESCRIPTION_MAX = 160;

/** Every page advertises the changes feed. A page's `alternates` replaces the layout's, so each one repeats it. */
export const FEED = { "application/rss+xml": "/changes/feed.xml" } as const;

export const IMAGE = { url: "/opengraph-image", width: 1200, height: 630 };
export const TWITTER_IMAGE ={ url: "/twitter-image", width: 1200, height: 630 };

/**
 * Page metadata with a complete Open Graph and Twitter set. A page's `openGraph` and `twitter` replace the
 * layout's instead of merging with them, so each page states its own title, description and image.
 * `title` goes through the layout's "%s · Everloot" template; the social title adds the site name itself.
 * Pass `image` for a route that has its own opengraph-image (the same path serves the Twitter card).
 */
export function pageMetadata(page: { title: string; description: string; path: string; image?: string; alt?: string; imageWidth?: number; imageHeight?: number }): Metadata {
  const social = `${page.title} · ${SITE_NAME}`;
  const size = { width: page.imageWidth ?? 1200, height: page.imageHeight ?? 630 };
  const og = page.image ? { url: page.image, ...size, alt: page.alt ?? social } : { ...IMAGE, alt: social };
  const tw = page.image ? { url: page.image, ...size, alt: page.alt ?? social } : { ...TWITTER_IMAGE, alt: social };
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: page.path, types: FEED },
    openGraph: { type: "website", siteName: SITE_NAME, title: social, description: page.description, url: page.path, images: [og] },
    twitter: { card: "summary_large_image", title: social, description: page.description, images: [tw] },
  };
}
