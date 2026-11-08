import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const rollup = vi.hoisted(() => ({ loadPopularAddons: vi.fn(), loadItemFacts: async () => ({ rates: [], names: [], npcs: [], unreachable: false }), loadWorldFacts: async () => ({ npcs: [], quests: [], vendors: [], unreachable: false }), loadInstanceFacts: async () => ({ entrances: [], encounters: [], sightings: [], unreachable: false, dataAsOf: null }) }));
vi.mock("@/lib/rollup-compute", () => rollup);
vi.mock("../../../lib/rollup-compute", () => rollup);
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import EcosystemPage, { metadata } from "./page";
import { loadEcosystem } from "@/lib/ecosystem";
import sitemap from "@/lib/site-sitemap";

const popular = (addons: { name: string; installs: number }[]) =>
  rollup.loadPopularAddons.mockResolvedValue({ addons, reportingInstalls: 9, unreachable: false, dataAsOf: "2026-10-17T12:00:00.000Z" });
const html = async () => renderToStaticMarkup(await EcosystemPage());

beforeEach(() => { rollup.loadPopularAddons.mockReset(); popular([]); });

test("the page lists the seeded projects with GitHub links that leave Everloot safely", async () => {
  const page = await html();
  for (const name of ["Everloot", "Polestar", "Olympus", "forever-ref"]) expect(page).toContain(`>${name}</h3>`);
  expect(page).toContain('href="https://github.com/fitzforge/polestar"');
  expect(page).toMatch(/rel="noopener noreferrer nofollow"/);
  expect(metadata.alternates?.canonical).toBe("/addons/ecosystem");
});

test("it names the five boards and says when GitHub was last read", async () => {
  const page = await html();
  for (const title of ["Most installed", "Rising", "Most active", "Freshest release", "Best maintained"]) expect(page).toContain(`>${title}</h3>`);
  expect(page).toMatch(/GitHub facts refreshed \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
});

test("installs are joined from the rollup: shown from three, otherwise 'not counted'", async () => {
  popular([{ name: "Polestar", installs: 7 }, { name: "Olympus", installs: 2 }]);
  const view = await loadEcosystem();
  expect(view.projects.find((p) => p.id === "polestar")!.installs).toBe(7);
  expect(view.projects.find((p) => p.id === "olympus")!.installs).toBeNull();
  const page = await html();
  expect(page).toContain("7 installs");
  expect(page).toContain("not counted");
  expect(page).toContain('href="/addons/Polestar"');
});

test("when install counts cannot be read, the installed board says so instead of looking empty", async () => {
  rollup.loadPopularAddons.mockResolvedValue({ addons: [], reportingInstalls: 0, unreachable: true, dataAsOf: null });
  expect(await html()).toContain("Install counts are unavailable right now.");
});

test("Forever-ready is shown with its caveat, and the page offers the submission issue", async () => {
  const page = await html();
  const { forever } = await loadEcosystem();
  expect(page).toContain("Forever-ready");
  expect(page).toContain("Interface 16001");
  expect(page).toContain(forever!.version);
  expect(page).toContain("not confirmed in the live client");
  expect(page).toContain("issues/new?template=ecosystem-project.yml");
});

test("the page names no person: no usernames or contributor lists", async () => {
  expect(await html()).not.toMatch(/contributors?\/|@[a-z]/i);
});

test("the sitemap lists the page", async () => {
  expect((await sitemap())!.map((e) => e.url)).toContain("https://everloot.app/addons/ecosystem");
});
