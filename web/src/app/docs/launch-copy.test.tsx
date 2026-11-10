import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/script", () => ({ default: () => null }));

import { LAUNCH_AT } from "@/data/wow-forever";
import AskClaude from "./cookbook/ask-claude/page";
import DropRates from "./cookbook/drop-rates-spreadsheet/page";
import Prices, { metadata as pricesMetadata } from "./cookbook/prices-in-a-script/page";
import TooltipsOnYourSite from "./cookbook/tooltips-on-your-site/page";
import Quickstart from "./quickstart/page";
import Tooltips from "./tooltips/page";
import { CLASSES, QUALITIES, tokens } from "@/design/tokens";

test("tooltip colour tables list every class and quality in both themes", () => {
  const html = renderToStaticMarkup(<Tooltips />);
  expect(html).toContain('id="colours-and-icons"');
  for (const key of [...CLASSES.map((c) => `class-${c}` as const), ...QUALITIES.map((q) => `q-${q}` as const)]) {
    expect(html).toContain(tokens.light[key]);
    expect(html).toContain(tokens.dark[key]);
  }
  for (const name of [...CLASSES, ...QUALITIES]) expect(html).toContain(name[0].toUpperCase() + name.slice(1));
});

// These pages are static: they are rendered once, before launch, and served after it. Their launch sentences
// must read true at either time, so each page renders the same at both clocks and none promises a launch to come.
const PAGES = { AskClaude, DropRates, Prices, TooltipsOnYourSite, Quickstart, Tooltips };

afterEach(() => { vi.useRealTimers(); });

const renderAt = (iso: string, Page: () => ReactNode): string => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
  return renderToStaticMarkup(<Page />).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
};

test.each(Object.entries(PAGES))("%s reads the same before and after launch, and names the launch date", (_, Page) => {
  const before = renderAt(new Date(Date.parse(LAUNCH_AT) - 1).toISOString(), Page);
  const after = renderAt(LAUNCH_AT, Page);
  expect(after).toBe(before);
  expect(after).toContain("4 November 2026");
  expect(after).not.toMatch(/launches on|before launch/i);
});

test("the prices recipe's description does not promise a launch to come", () => {
  expect(pricesMetadata.description).not.toMatch(/before launch/i);
});
