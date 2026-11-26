import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

// The hub reads its reviewed guides from kb/guides; here they are stood in for (classes.test.tsx reads real files).
const hubData = vi.hoisted(() => ({ guides: [] as unknown[] }));
vi.mock("@/lib/class-hub", async (original) => ({
  ...(await original<typeof import("@/lib/class-hub")>()),
  classGuides: () => hubData.guides,
}));
// The asset folder's manifest, stood in for: the class icon and tree icons the calculator also shows.
const assets = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/game-assets", async (original) => ({
  ...(await original<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => assets.value,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  useSearchParams: () => new URLSearchParams(),
}));

import ClassHubPage, * as route from "./page";
import { classLabel } from "@/lib/class-context";
import { guideHref } from "@/lib/guides";
import { TALENT_CLASSES } from "@/lib/talents/catalogs";

// The class is read from the catalog list, never typed here; the guide is made up (docs/DATA_POLICY.md).
const slug = TALENT_CLASSES[0]!;
const name = classLabel(slug);
const GUIDE = { slug: "made-up-plan", title: "A made-up plan", summary: "Words for a test.", activity: "leveling", levels: { from: 10, to: 20 }, roles: ["damage"] };
const params = (value: string) => ({ params: Promise.resolve({ class: value }) });
const render = async (value: string = slug) => renderToStaticMarkup(await ClassHubPage(params(value)));

beforeEach(() => { hubData.guides = []; assets.value = null; });

test("one hub per catalog class is built at deploy, and it may never read the request", () => {
  expect(route.dynamic).toBe("error");
  expect(route.dynamicParams).toBe(false);
  expect(route.generateStaticParams()).toEqual(TALENT_CLASSES.map((c) => ({ class: c })));
});

test("the hub is titled with its class and links the calculator, the census, the class ranking and the races", async () => {
  const meta = await route.generateMetadata(params(slug));
  expect(meta.title).toBe(`WoW Forever ${name}`);
  expect(meta.alternates?.canonical).toBe(`/classes/${slug}`);
  const html = await render();
  expect(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]).toContain(name);
  expect(html).toContain(`href="/tools/talents/${slug}"`);
  expect(html).toMatch(/href="\/census\?[^"]+"/);
  expect(html).toContain('href="/rankings/classes"');
  expect(html).toContain('href="/wow-forever#races"');
});

test("with no reviewed guide the hub shows the shared empty state for its class; with one it links the guide", async () => {
  // The words are guides-empty.test.tsx's; here, that the hub renders it for this class.
  const empty = await render();
  expect(empty).toContain("data-guides-empty");
  expect(empty).toContain(`No ${name} guide is reviewed yet.`);
  hubData.guides = [GUIDE];
  const html = await render();
  expect(html).not.toContain("data-guides-empty");
  expect(html).toContain(`href="${guideHref(GUIDE.slug)}"`);
  expect(html).toContain("A made-up plan");
  expect(html).toContain("Levels 10–20");
});

test("an address that is not a catalog class is a 404 and stays out of search", async () => {
  await expect(render("class-0")).rejects.toThrow("NEXT_NOT_FOUND");
  expect((await route.generateMetadata(params("class-0"))).robots).toEqual({ index: false, follow: true });
});

test("the title carries the game's class icon and the trees their icons when the asset folder has them, and none without it", async () => {
  const plain = await render();
  expect(plain).not.toContain("<img");
  assets.value = { classes: new Map([[slug, { name, icon: "https://assets.test/icons/class.webp", trees: [{ name: null, icon: "https://assets.test/icons/tree.webp" }] }]]) };
  const html = await render();
  expect(/<header[\s\S]*?<\/header>/.exec(html)?.[0]).toContain('src="https://assets.test/icons/class.webp"');
  expect(html).toContain('src="https://assets.test/icons/tree.webp"');
});
