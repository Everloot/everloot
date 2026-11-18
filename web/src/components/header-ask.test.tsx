import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className, "aria-current": current }: { href: string; children: ReactNode; className?: string; "aria-current"?: "page" }) => (
    <a href={href} aria-current={current} className={className}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/chat", useRouter: () => ({ refresh: () => {} }) }));
vi.mock("./AccountControls", () => ({ default: () => null }));

import Header from "./Header";

const html = renderToStaticMarkup(<Header />);
const primary = html.match(/<nav aria-label="Primary"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";

test("on /chat the bar marks Chat current, and no menu", () => {
  expect(primary).toMatch(/<a href="\/chat" aria-current="page" class="[^"]*border-accent[^"]*">Chat<\/a>/);
  const buttons = [...primary.matchAll(/<button [^>]*class="([^"]*)"/g)].map((m) => m[1]);
  expect(buttons).toHaveLength(5);
  for (const cls of buttons) expect(cls).toContain("border-transparent");
  // Chat is its own item, in no menu.
  expect(html.match(/id="tools-menu"[\s\S]*?<\/div><\/div>/)?.[0]).not.toContain('href="/chat"');
});
