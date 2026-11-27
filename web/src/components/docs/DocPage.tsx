import Link from "@/components/Link";
import type { ReactNode } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { docsPage, neighbours } from "@/lib/docs/nav";
import { CopyPage, OnThisPage } from "./DocsClient";

/**
 * One docs page: breadcrumb, title, lede and "Copy page", the article, then previous and next. Beside it
 * on wide screens, "On this page" — or, for an endpoint, the `aside` (its code panel) in that column.
 * Title and lede come from the docs table of contents, so the sidebar, cards and page always agree.
 */
export default function DocPage({ href, children, aside, title, lede }: { href: string; children: ReactNode; aside?: ReactNode; title?: ReactNode; lede?: ReactNode }) {
  const page = docsPage(href);
  if (!page) throw new Error(`${href} is not in the docs table of contents (lib/docs/nav.ts)`);
  const { prev, next } = neighbours(href);
  const trail = [
    { name: "Home", path: "/" },
    { name: "Docs", path: "/docs" },
    ...(page.tab.href !== "/docs" && page.tab.href !== href ? [{ name: page.tab.label, path: page.tab.href }] : []),
    ...(href !== "/docs" ? [{ name: page.title, path: href }] : []),
  ];
  return (
    <div className={`grid min-w-0 gap-10 ${aside ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]" : "xl:grid-cols-[minmax(0,1fr)_12rem]"}`}>
      <div className="min-w-0">
        <article data-docs-article className="min-w-0">
          <PageHeader trail={trail} title={title ?? page.title} lede={lede ?? page.lede} actions={<CopyPage />} />
          {children}
        </article>
        {aside && <div className="mt-10 space-y-4 xl:hidden">{aside}</div>}
        <nav aria-label="Previous and next page" data-md-skip className="mt-16 grid gap-4 border-t border-line pt-8 sm:grid-cols-2">
          {prev ? (
            <Link href={prev.href} className="group rounded-card border border-line p-4 transition-colors hover:border-accent">
              <span className="block text-xs text-muted">Previous</span>
              <span className="mt-1 block font-medium text-fg group-hover:text-accent">{prev.title}</span>
            </Link>
          ) : <span />}
          {next && (
            <Link href={next.href} className="group rounded-card border border-line p-4 text-right transition-colors hover:border-accent">
              <span className="block text-xs text-muted">Next</span>
              <span className="mt-1 block font-medium text-fg group-hover:text-accent">{next.title}</span>
            </Link>
          )}
        </nav>
      </div>
      <div className="hidden xl:block">
        <div className="sticky top-24 max-h-[calc(100vh-7rem)] space-y-4 overflow-y-auto">
          {aside ?? <OnThisPage />}
        </div>
      </div>
    </div>
  );
}
