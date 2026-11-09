import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

/** The guide reads its switches at render, so each case imports it fresh. */
async function render(): Promise<string> {
  const { default: Page } = await import("./page");
  return renderToStaticMarkup(Page());
}

test("with the showcase on, the guide links the sample character page as what a character page looks like", async () => {
  vi.stubEnv("EVERLOOT_SHOWCASE", "1");
  const html = await render();
  expect(html).toContain('href="/showcase/character"');
  expect(html).toContain("What your character page looks like once you link a character");
});

test("with the showcase off, the guide does not point at a page that answers 404", async () => {
  vi.stubEnv("EVERLOOT_SHOWCASE", "");
  expect(await render()).not.toContain("/showcase/character");
});
