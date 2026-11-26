import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, onNavigate: _onNavigate, ...props }: { children: React.ReactNode; onNavigate?: () => void; href: string }) => <a {...props}>{children}</a>,
}));

import { ResultStrip, stripBelow } from "./Pager";

// A list draws its result strip above and below the table. Two page navs with one name break axe's
// "landmark-unique": the one below the list says so in its name.

const strip = <ResultStrip total={120} noun="items" page={2} perPage={50} href={(p) => `/x?page=${p}`} label="Item pages" />;
const navNames = (html: string) => [...html.matchAll(/<nav aria-label="([^"]*)"/g)].map((m) => m[1]);

test("the strip below a list names its pager apart from the one above", () => {
  const html = renderToStaticMarkup(<>{strip}{stripBelow(strip)}</>);
  expect(navNames(html)).toEqual(["Item pages", "Item pages, below the list"]);
});

test("the default label gets the same suffix", () => {
  const plain = <ResultStrip total={120} noun="guilds" page={1} perPage={50} href={(p) => `/g?page=${p}`} />;
  expect(navNames(renderToStaticMarkup(<>{plain}{stripBelow(plain)}</>))).toEqual(["Pages", "Pages, below the list"]);
});

test("no list page draws the same strip twice under one name", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) files.push(path);
    }
  };
  walk(join(__dirname, "../../app"));
  const offenders = files.filter((f) => /\{strip\}<\/div>/.test(readFileSync(f, "utf8")));
  expect(offenders).toEqual([]);
});
