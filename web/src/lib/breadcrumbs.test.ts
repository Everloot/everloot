import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { trailFor } from "./breadcrumbs";
import { CLIENT_PROFESSIONS } from "./professions";
import Breadcrumbs from "@/components/Breadcrumbs";

const location = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => location.path }));

const paths = [
  ["/database/objects", "/database"], ["/database/items", "/database"],
  ["/guides"], ["/guilds"], ["/classes"], ["/classes/choose", "/classes"],
  ["/classes/group", "/classes"], ["/players"], ["/players/opt-out", "/players"],
  ["/guilds/hide", "/guilds"], ["/chat"], ["/addon"], ["/methodology"],
  ["/account"], ["/settings"], ["/me"],
];

test.each(paths)("%s has a named trail through its parent", (path, parent) => {
  const trail = trailFor(path);
  expect(trail?.map((crumb) => crumb.path)).toEqual(["/", ...(parent ? [parent] : []), path]);
  expect(trail?.every((crumb) => Boolean(crumb.name))).toBe(true);
  expect(trailFor(`${path}/`)).toEqual(trail);
  location.path = path;
  const html = renderToStaticMarkup(createElement(Breadcrumbs));
  const block = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1]);
  expect(block["@type"]).toBe("BreadcrumbList");
  expect(block.itemListElement.map((item: { name: string }) => item.name)).toEqual(trail!.map((crumb) => crumb.name));
});

test("profession slugs have their own name and the profession hub as parent", () => {
  for (const profession of CLIENT_PROFESSIONS) {
    const path = `/tools/professions/${profession.slug}`;
    expect(trailFor(path)).toEqual([...trailFor("/tools/professions")!, { name: profession.name, path }]);
  }
  expect(trailFor("/tools/professions/not-a-profession")).toBeNull();
});

test("pages use the shared Home crumb", () => {
  function pages(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? pages(path) : /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
    });
  }
  for (const path of pages(join(process.cwd(), "src/app"))) {
    expect(readFileSync(path, "utf8"), path).not.toMatch(/\{\s*name:\s*["']Home["'],\s*path:\s*["']\/["']\s*\}/);
  }
});
