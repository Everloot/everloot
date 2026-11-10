import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import Page from "./page";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

test("the Desktop guide gives each app page one row", () => {
  const html = renderToStaticMarkup(Page());
  const pages = html.slice(html.indexOf('id="pages"'), html.indexOf('id="signing-in"'));
  for (const page of ["Overview", "Chat", "Characters", "Upload", "Market", "Ask", "Addon", "Changes", "Log", "Settings"]) {
    expect(pages).toMatch(new RegExp(`<td[^>]*>${page}</td>`));
  }
  expect(pages.match(/<tr[ >]/g)).toHaveLength(11);
});

test("the guide explains sign-in permissions and local data", () => {
  const html = renderToStaticMarkup(Page());
  expect(html).toContain("Sign in with everloot.app");
  expect(html).toContain("Read my saved builds");
  expect(html).toContain("Character links and optional private sync");
  expect(html).toContain("Uploads and prices work without signing in");
  expect(html).toContain("does not upload your local chat transcript, backups or model keys");
  expect(html).toContain("conversation history and any local character details used to answer");
});
