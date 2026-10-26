import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { LAUNCH } from "@/data/wow-forever";
import { POSTS, RULESETS, RULESETS_POST } from "@/data/wow-forever-launch";
import { postPath } from "@/lib/changes";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

import Page from "./page";

const visible = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const at = async (iso: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
  return renderToStaticMarkup(await Page());
};
const section = (html: string, id: string) => {
  const start = html.indexOf(`aria-labelledby="${id}"`);
  return html.slice(start, html.indexOf("</section>", start));
};

afterEach(() => vi.useRealTimers());

test("before launch: the checklist, the rulesets and the FAQ are there, in that order, ahead of the race tables", async () => {
  const html = await at("2026-10-26T12:00:00Z");
  const order = ["launch", "checklist", "rulesets", "faq", "races", "latest"].map((id) => html.indexOf(`aria-labelledby="${id}"`));
  expect(order.every((n) => n > 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  const text = visible(section(html, "checklist"));
  expect(text).toContain("Before launch");
  expect(text).toContain("Name reservations, October 27 through November 3. Not open yet.");
  expect(text).toContain("Launch day, November 4, 2026, 3:00 p.m. PST");
  expect(text).not.toContain("Launch week checklist");
  expect(text).not.toContain("December 9");
  expect(section(html, "checklist")).toContain('href="/tools/talents"');
  expect(section(html, "checklist")).toContain('href="/addons"');
});

test("launch week: the heading and the dated steps move on with the clock", async () => {
  const html = await at("2026-11-05T12:00:00Z");
  const text = visible(section(html, "checklist"));
  expect(text).toContain("Launch week checklist");
  expect(text).toContain("Closed.");
  expect(text).toContain("WoW: Forever has launched.");
  expect(text).toContain("December 9, the level 60 raids");
  expect(visible(await at("2026-10-28T12:00:00Z"))).toContain("Open now.");
});

test("the ruleset table lists every ruleset and links the explainer and Blizzard's article", async () => {
  const html = await at("2026-10-26T12:00:00Z");
  const rulesets = section(html, "rulesets");
  expect(rulesets.match(/<tr/g)).toHaveLength(RULESETS.length + 1);
  for (const r of RULESETS) expect(visible(rulesets)).toContain(r.name);
  expect(rulesets).toContain(`href="${RULESETS_POST.path}"`);
  expect(rulesets).toContain(`href="${RULESETS_POST.blizzardUrl}"`);
});

test("the FAQ has eight questions, every answer carries a link, and each date matches its post", async () => {
  const html = await at("2026-10-26T12:00:00Z");
  const faq = section(html, "faq");
  expect(faq.match(/<h3/g)).toHaveLength(8);
  for (const answer of faq.split("<h3").slice(1)) expect(answer).toContain("<a ");
  const text = visible(faq);
  expect(text).toContain("November 4, 2026, at 3:00 p.m. PST");
  expect(text).toContain("From October 27 through November 3, for up to three characters");
  expect(text).toContain("unlock on December 9");
  expect(text).toContain("closed it on October 23");
  expect(faq).toContain(`href="${LAUNCH.sourceUrl}"`);
  for (const ref of Object.values(POSTS)) expect(html).toContain(`href="${postPath(ref)}"`);
});
