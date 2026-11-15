// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
import Page, { generateStaticParams, generateMetadata, dynamic, dynamicParams } from "./[level]/page";
import Index from "./page";
import LevelView from "./LevelView";
import { buildLevelUnlocks, type LevelData } from "@/lib/level-unlocks";
import { loadLevelData, levelSitemapPaths } from "@/lib/level-page-data";
let root: Root | undefined;
afterEach(async () => { if (root) await act(() => root?.unmount()); root = undefined; localStorage.clear(); vi.restoreAllMocks(); });
test("exports exactly 60 static routes and rejects malformed params", async () => {
  expect(dynamic).toBe("error"); expect(dynamicParams).toBe(false);
  expect(generateStaticParams()).toEqual(Array.from({ length: 60 }, (_, i) => ({ level: String(i + 1) })));
  for (const level of ["0", "61", "01", "x"]) await expect(Page({ params: Promise.resolve({ level }) })).rejects.toThrow("NEXT_NOT_FOUND");
});
test("renders data honesty, database links, breadcrumbs and correct indexing", async () => {
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ level: "60" }) }));
  expect(html).toContain("Not confirmed yet"); expect(html).toContain("BreadcrumbList");
  expect(html).not.toContain('aria-labelledby="level-spells"'); expect(html).not.toContain('aria-labelledby="level-zones"');
  expect(html).toContain("/database/instances/"); expect(html).toContain("/tools/talents/mage");
  expect(html).toContain("/classes/mage");
  const params = (level: string) => ({ params: Promise.resolve({ level }) });
  expect((await generateMetadata(params("1"))).robots).toEqual({ index: false, follow: true });
  expect((await generateMetadata(params("60"))).robots).toEqual({ index: true, follow: true });
  const paths = await levelSitemapPaths();
  expect(paths).toContain("/tools/level/60"); expect(paths).not.toContain("/tools/level/1");
  expect(renderToStaticMarkup(<Index />).match(/href="\/tools\/level\/\d+"/g)).toHaveLength(60);
  const data = await loadLevelData(); expect(data.spells).toBeNull(); expect(data.zones).toBeNull(); expect(data.trainers).toBeNull();
});
const fixture: LevelData = { classes: [{ slug: "mage", name: "Mage", pointLevels: [10] }, { slug: "warrior", name: "Warrior", pointLevels: [10] }], spells: null, zones: null, instances: [], trainers: null };
async function mount() {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(() => root!.render(<LevelView level={10} unlocks={buildLevelUnlocks(fixture, 10)} classes={fixture.classes} />));
  return host;
}
test("class URL wins over device choice; selection, copy and level links preserve it", async () => {
  window.history.replaceState(null, "", "/tools/level/10?class=mage");
  localStorage.setItem("everloot.level.class", "warrior");
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const host = await mount();
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Class"]')!;
  expect(select.value).toBe("mage"); expect(localStorage.getItem("everloot.level.class")).toBe("mage");
  expect(host.querySelector('a[aria-label="Next level"]')?.getAttribute("href")).toBe("/tools/level/11?class=mage");
  await act(() => { select.value = "warrior"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(window.location.search).toBe("?class=warrior"); expect(host.textContent).not.toContain("Mage talent calculator");
  const copy = host.querySelector("button")!;
  await act(() => copy.click()); expect(writeText).toHaveBeenCalledWith(window.location.href); expect(host.textContent).toContain("Link copied");
});
test("restores the last class and tolerates blocked storage", async () => {
  window.history.replaceState(null, "", "/tools/level/10"); localStorage.setItem("everloot.level.class", "mage");
  let host = await mount(); expect(host.querySelector("select")?.value).toBe("mage");
  await act(() => root!.unmount()); root = undefined;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  window.history.replaceState(null, "", "/tools/level/10?class=warrior");
  host = await mount(); expect(host.querySelector("select")?.value).toBe("warrior");
});
