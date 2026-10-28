import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

import AboutPage from "./page";
import { metadata as chatMetadata } from "../chat/page";

test("How it stays free separates Everloot's free search from an optional AI provider's own pricing and limits", () => {
  const html = renderToStaticMarkup(<AboutPage />);
  const free = /<section aria-labelledby="free">(.*?)<\/section>/s.exec(html)?.[1] ?? "";
  expect(free).toContain("Everloot search is free");
  expect(free).toMatch(/AI model.*your own provider account.*pricing and limits/s);
  expect(free).toContain("not an API key");
  expect(free).toContain('href="/chat"');
  // The funding statement is kept as it was.
  expect(free).toContain("clearly labelled");
  expect(free).toContain("popups or interstitials");
});

test("the chat page describes sourced search first and the model as optional and the player's own", () => {
  const description = String(chatMetadata.description);
  expect(description.indexOf("sources")).toBeGreaterThan(-1);
  expect(description).toMatch(/optional/i);
  expect(description).toContain("Your key lasts only in this tab");
});
