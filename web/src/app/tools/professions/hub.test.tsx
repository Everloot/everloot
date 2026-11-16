import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => null,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); } }));
vi.mock("@/components/EmailCapture", () => ({ default: () => null }));

import ProfessionsPage from "./page";

const render = async (search: Record<string, string> = {}) =>
  renderToStaticMarkup(await ProfessionsPage({ searchParams: Promise.resolve(search) }));

test("the hub lists every profession from the game files with its recipe count, even without icons", async () => {
  const html = await render();
  expect(html).toContain('href="/tools/professions/alchemy"');
  expect(html).toContain('href="/tools/professions/first-aid"');
  expect(html).toContain("recipes in the files");
  expect(html).toContain("found in game files, unconfirmed, build 1.60.1.70938");
});

test("the old form's links go to the profession's page with the same range and class context", async () => {
  await expect(render({ profession: "Alchemy", from: "1", to: "11" })).rejects.toThrow("NEXT_REDIRECT /tools/professions/alchemy?from=1&to=11");
  await expect(render({ profession: "first aid", class: "mage" })).rejects.toThrow("NEXT_REDIRECT /tools/professions/first-aid?class=mage");
  // A name the files do not list stays on the hub.
  expect(await render({ profession: "Riding" })).toContain("Professions");
});
