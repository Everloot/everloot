import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

// The catalog cannot load: no redirect runs, so a requested URL is not known to be the canonical one.
vi.mock("@/lib/completion-lists", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/completion-lists")>()),
  loadCatalog: async () => null,
}));
vi.mock("@/lib/release", () => ({ getRelease: () => null }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
  useRouter: () => ({ push: () => {} }),
}));

import Faction from "./factions/[id]/page";
import Title from "./titles/[id]/page";
import Chain from "./quest-chains/[id]/page";

const props = (id: string) => ({ params: Promise.resolve({ id }) });

test.each([
  { kind: "faction", page: () => Faction(props("21-wrong-name")) },
  { kind: "title", page: () => Title(props("144-wrong-name")) },
  { kind: "quest_chain", page: () => Chain(props("5963-wrong-name")) },
])("an unreachable catalog gives the $kind page no entity block naming the requested URL", async ({ page }) => {
  const html = renderToStaticMarkup(await page());
  expect(html).toContain("<h1");
  expect(html).not.toContain('"@type":"WebPage"');
});
