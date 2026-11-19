import type { ReactNode } from "react";
import JsonLd from "@/components/JsonLd";
import { trailFor } from "@/lib/breadcrumbs";
import { breadcrumbJsonLd, type Crumb } from "@/lib/jsonld";
import Banner from "./Banner";
import { QUALITY_TEXT, type Quality } from "./quality";

export interface PageHeaderProps {
  /** The page's one h1. One size on every page. */
  title: ReactNode;
  /** One line under the title: what the page is. Not a paragraph. */
  lede?: ReactNode;
  /**
   * Home first, the page last. Never drawn (no visible breadcrumbs); it feeds the page's
   * BreadcrumbList. Pages listed in lib/breadcrumbs.ts can pass `trailFor(path)`.
   */
  trail?: Crumb[];
  /** Small facts beside each other under the lede: badges, an id, a date, an agreement meter. */
  meta?: ReactNode;
  /** Buttons or links at the right of the title (below it on a phone). */
  actions?: ReactNode;
  /** A game icon before the title, for entity pages. */
  icon?: ReactNode;
  /** Colours the title as an item of this quality. */
  quality?: Quality;
  /**
   * Section hubs only: a wide-screen picture with the title on it (see Banner). `image` is the
   * decorative picture; the banner adds its one-line caption. The lede, meta and actions follow under
   * the picture. The header must then sit directly in the layout's main, not in a Container.
   */
  banner?: { image: ReactNode };
}

const TITLE = "text-title-sm [overflow-wrap:anywhere] sm:text-title";

/**
 * The page-title pattern, the same on every page: title, one-line lede, then meta and actions. Compact
 * (density spec, 2026-10-20): a 28 px title (22 on a phone), a 14 px lede and 13 px meta, no rule under
 * it. No line above the title: no breadcrumb, no bracket eyebrow, no "Tool ·" label.
 */
export default function PageHeader({ title, lede, trail, meta, actions, icon, quality, banner }: PageHeaderProps) {
  // The layout already emits the BreadcrumbList for routes lib/breadcrumbs.ts knows; emit it here
  // only for the others (entity pages), so a page never carries two.
  const page = trail?.[trail.length - 1];
  const emitJsonLd = trail && trail.length > 1 && page && !trailFor(page.path);
  const metaRow = meta && <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted">{meta}</div>;
  if (banner) {
    return (
      <header data-page-header className="mb-6">
        {emitJsonLd && <JsonLd data={breadcrumbJsonLd(trail)} />}
        <Banner image={banner.image}>
          <h1 className={`${TITLE} text-fg`}>{title}</h1>
        </Banner>
        {lede && <p className="mt-3 max-w-lede text-cell text-fg-2">{lede}</p>}
        {(meta || actions) && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-8 gap-y-2">
            {metaRow}
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
        )}
      </header>
    );
  }
  return (
    <header data-page-header className="mb-4">
      {emitJsonLd && <JsonLd data={breadcrumbJsonLd(trail)} />}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
        <div className="min-w-0 flex-1 basis-80">
          <div className="flex items-center gap-3">
            {icon && <span className="shrink-0">{icon}</span>}
            <h1 className={`min-w-0 ${TITLE} ${quality ? QUALITY_TEXT[quality] : "text-fg"}`}>{title}</h1>
          </div>
          {lede && <p className="mt-1 max-w-lede text-cell text-fg-2">{lede}</p>}
          {meta && <div className="mt-2">{metaRow}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
