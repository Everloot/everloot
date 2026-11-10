import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

import HomeTrust from "./HomeTrust";

const render = (summary: Parameters<typeof HomeTrust>[0]["summary"]) => renderToStaticMarkup(<HomeTrust summary={summary} />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const figure = (html: string, id: string) => text(html.slice(html.indexOf(`data-figure="${id}"`) + `data-figure="${id}">`.length).split("</div>")[0]);

const data = { installs: 14, confirmed: 2785, waiting: 12250, dataAsOf: "2026-11-10T07:50:00.000Z", build: "1.60.1.70862" };

test("the promise, the three numbers each saying what it counts, and the data date", () => {
  const html = render(data);
  expect(text(html)).toContain("Every fact shows how many players saw it, and when.");
  expect(figure(html, "installs")).toBe("installs that uploaded 14 Overall: every install that uploaded, in any zone.");
  expect(figure(html, "confirmed")).toBe("confirmed facts 2,785 In released zones: facts that 3 or more installs agree on.");
  expect(figure(html, "waiting")).toBe("facts waiting 12,250 In released zones: seen by 1 or 2 installs; each needs 1 or 2 more to agree.");
  expect(text(html)).toContain("Data as of 2026-11-10 07:50 UTC, build 1.60.1.70862.");
  expect(text(html)).toContain("From the coverage report the snapshot job stores.");
  expect(text(html)).toContain("Uploads help confirm facts once 3 installs agree.");
  expect(text(html)).not.toMatch(/same score|MCP|every install that uploads moves|every upload confirms/i);
  expect(html).not.toContain("unrecorded");
});

test("it links Get the addon and the coverage page, and fills no button", () => {
  const html = render(data);
  expect(html).toContain('href="/addon"');
  expect(html).toContain('href="/database/coverage"');
  expect(html).not.toContain("btn-primary");
});

test("one install reads as one install, and a measured zero is shown as 0", () => {
  const html = render({ ...data, installs: 1, confirmed: 0, waiting: 0 });
  expect(figure(html, "installs")).toMatch(/^install that uploaded 1 /);
  expect(figure(html, "confirmed")).toMatch(/^confirmed facts 0 /);
  expect(html).not.toContain("unrecorded");
});

test("an undated score says the data age is unrecorded", () => {
  expect(text(render({ ...data, dataAsOf: null, build: null }))).toContain("Data age unrecorded.");
});

test("a score that cannot be read says unrecorded for every figure and never a zero", () => {
  const html = render(null);
  for (const id of ["installs", "confirmed", "waiting"]) expect(figure(html, id)).toContain("unrecorded");
  expect(text(html)).toContain("Data age unrecorded: the coverage score could not be read just now.");
  expect(html).not.toMatch(/data-figure="[a-z]+"[^>]*>\s*<dt[^>]*>[^<]*<\/dt>\s*<dd[^>]*>0</);
  expect(text(html)).not.toMatch(/\b0\b/);
});
