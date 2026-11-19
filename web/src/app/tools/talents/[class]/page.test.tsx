import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  usePathname: () => "/tools/talents",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import TalentClassPage, * as route from "./page";
import { pageTitle } from "@/components/talents/TalentClassView";
import { TALENT_CLASSES, loadCatalog } from "@/lib/talents/catalogs";

// The class is read from the catalog list, never typed here: fixtures name no game class (docs/DATA_POLICY.md).
const slug = TALENT_CLASSES[0]!;
const params = (value: string) => ({ params: Promise.resolve({ class: value }) });
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("one page per catalog class is built, and no other address is served", () => {
  expect(route.dynamicParams).toBe(false);
  expect(route.generateStaticParams()).toEqual(TALENT_CLASSES.map((c) => ({ class: c })));
});

test("a class page is titled with its class, canonical at its own address, with its own preview image", async () => {
  const { className } = await loadCatalog(slug);
  const meta = await route.generateMetadata(params(slug));
  expect(meta.title).toBe(pageTitle(className));
  expect(meta.alternates?.canonical).toBe(`/tools/talents/${slug}`);
  expect(JSON.stringify(meta.openGraph)).toContain(`/tools/talents/${slug}/opengraph-image`);
  const html = renderToStaticMarkup(await TalentClassPage(params(slug)));
  expect(text(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)![1]!).trim()).toBe(pageTitle(className));
  // The calculator links its class's hub.
  expect(html).toContain(`href="/classes/${slug}"`);
});

test("an address that is not a catalog class is a 404 with no metadata", async () => {
  await expect(TalentClassPage(params("class-0"))).rejects.toThrow("NEXT_NOT_FOUND");
  expect(await route.generateMetadata(params("class-0"))).toEqual({});
});
