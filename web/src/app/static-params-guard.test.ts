import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

/**
 * A page that lists its params up front (generateStaticParams) is rendered once and kept (ISR). Reading the query string
 * (searchParams) in such a page makes it dynamic at request time, and in production Next.js answers that with a 500
 * ("Page changed from static to dynamic at runtime"): every realm item price page did, after #1686 read `?house=`.
 * A page may do one or the other, not both.
 */
const app = fileURLToPath(new URL(".", import.meta.url));

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}

test("no page both lists its params up front and reads the query string", () => {
  const both = pages(app)
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      return /\bgenerateStaticParams\b/.test(source) && /\bsearchParams\b/.test(source);
    })
    .map((file) => relative(app, file).replaceAll("\\", "/"));
  expect(both).toEqual([]);
});
