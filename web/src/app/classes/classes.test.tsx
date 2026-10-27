// @vitest-environment jsdom
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Metadata } from "next";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// The address the app router reports to the client component, set per test.
const address = vi.hoisted(() => ({ search: "" }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  useSearchParams: () => new URLSearchParams(address.search),
}));

import ClassesPage, * as indexRoute from "./page";
import ClassPage, * as hubRoute from "./[class]/page";
import UseClassButton, { RememberedClass } from "@/components/classes/UseClassButton";
import { PRIMARY } from "@/components/Header";
import { toolGroups } from "@/data/tools";
import { classRaces } from "@/lib/class-hub";
import { CLASS_CONTEXT_SLOT, contextLinks } from "@/lib/class-context";
import { TALENT_CLASSES, loadCatalog } from "@/lib/talents/catalogs";
import { fixture } from "@/lib/talents/fixture";
import { encodeBuild, encodeOrder } from "@/lib/talents/share";
import type { Ranks } from "@/lib/talents/types";

/* ---------- Fixture guides ---------- */

const RANKS: Ranks = { 11: { rank: 5 }, 21: { rank: 1 } };
const code = (classSlug: string) => encodeBuild({ classSlug, specId: fixture.specId, build: fixture.build, ranks: RANKS });
const PLANNED = encodeOrder(RANKS, [11, 11, 11, 11, 11, 21], "planned")!;

interface FixtureGuide { slug: string; title: string; classSlug: string; status?: "draft" | "published"; activity?: string; roles?: string; levels?: string; summary?: string }

function guideFile(g: FixtureGuide, id: number): string {
  const published = (g.status ?? "published") === "published";
  return `---
id: ${id}
slug: ${g.slug}
version: 1
status: ${published ? "published" : "draft"}
title: ${g.title}
summary: "${g.summary ?? "A test guide."}"
classSlug: ${g.classSlug}
activity: ${g.activity ?? "leveling"}
roles: ${g.roles ?? "[damage]"}
levels: ${g.levels ?? "{ from: 10, to: 60 }"}
code: ${code(g.classSlug)}
order: ${PLANNED}
author: Robin
reviewed: ${published ? "{ by: Kai, on: 2026-10-20, build: 1.0.0.1 }" : "null"}
history: ${published ? "[{ version: 1, on: 2026-10-20, by: Kai, build: 1.0.0.1, note: First published version. }]" : "[]"}
---

## Who it is for

Test words.
`;
}

/** A fresh guides folder (the reader keeps one copy per folder), pointed at through GUIDES_DIR. */
function stubGuides(guides: FixtureGuide[]): void {
  const dir = mkdtempSync(join(tmpdir(), "class-guides-"));
  writeFileSync(join(dir, "README.md"), "# not a guide");
  guides.forEach((g, i) => writeFileSync(join(dir, `${g.slug}.md`), guideFile(g, i + 1)));
  vi.stubEnv("GUIDES_DIR", dir);
}

const SOME: FixtureGuide[] = [
  { slug: "frost-leveling", title: "Frost leveling", classSlug: "mage", summary: "A Mage plan for levels 10 to 60." },
  { slug: "fire-draft", title: "Fire draft", classSlug: "mage", status: "draft" },
  { slug: "warrior-tanking", title: "Warrior tanking", classSlug: "warrior", activity: "dungeons", roles: "[tank, damage]", levels: "{ from: 20, to: 60 }" },
];

/* ---------- Rendering ---------- */

const visible = (html: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script").forEach((s) => s.remove());
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.nodeValue ?? "");
  return ` ${parts.join(" ")} `.replace(/\s+/g, " ");
};
const hub = async (slug: string) => renderToStaticMarkup(await ClassPage({ params: Promise.resolve({ class: slug }) }));
const hubMetadata = (slug: string) => hubRoute.generateMetadata({ params: Promise.resolve({ class: slug }) });
const index = async () => renderToStaticMarkup(await ClassesPage());
/** The line under the page title. */
const ledeOf = (html: string) => visible(html.match(/<\/h1>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "");
/** The part of the page under one section heading, up to the next. */
const section = (html: string, id: string) => {
  const at = html.indexOf(`id="${id}"`);
  return at < 0 ? "" : html.slice(at, html.indexOf("</section>", at));
};

function complete(path: string, m: Metadata) {
  const title = String(m.title);
  expect(title, path).toMatch(/^WoW Forever /);
  expect(String(m.description).length, `${path}: ${m.description}`).toBeGreaterThanOrEqual(120);
  expect(String(m.description).length, `${path}: ${m.description}`).toBeLessThanOrEqual(160);
  expect(m.alternates?.canonical, path).toBe(path);
  const og = m.openGraph as { title?: string; url?: string; description?: string };
  expect(og.title, path).toBe(`${title} · Everloot`);
  expect(og.url, path).toBe(path);
  expect(og.description, path).toBe(m.description);
}

beforeEach(() => {
  address.search = "";
  localStorage.clear();
  stubGuides([]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("class hubs", () => {
  test("the nine classes each have a hub, built once per deploy, and any other address is a 404", async () => {
    expect(hubRoute.generateStaticParams().map((p) => p.class)).toEqual(TALENT_CLASSES);
    expect(hubRoute.dynamicParams).toBe(false);
    // Built at deploy, and the build fails before a page is rendered for a request: the guides are read from
    // kb/guides while building, never by a request.
    expect(hubRoute.dynamic).toBe("error");
    expect(indexRoute.dynamic).toBe("error");
    for (const bad of ["deathknight", "Mage", "choose", "mage "]) await expect(hub(bad), bad).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await hubMetadata("deathknight")).robots).toEqual({ index: false, follow: true });
  });

  test("with no reviewed guide a hub says so, names no role or talent tree, and stays out of search", async () => {
    const html = await hub("mage");
    const page = visible(html);
    expect(page).toContain("No Mage guide is reviewed yet.");
    // The line under the title does not promise guides that are not there.
    expect(ledeOf(html)).toContain("talent calculator");
    expect(ledeOf(html)).not.toMatch(/guide/i);
    for (const role of ["tank", "healer", "damage", "dps"]) expect(page.toLowerCase(), role).not.toContain(role);
    for (const tree of (await loadCatalog("mage")).trees) expect(page, tree.name).not.toContain(tree.name);
    const m = await hubMetadata("mage");
    expect(m.robots).toEqual({ index: false, follow: true });
    complete("/classes/mage", m);
  });

  test("a reviewed guide shows on its own class's hub only, with the activity, levels and roles it was reviewed for; a draft never does", async () => {
    stubGuides(SOME);
    const mage = await hub("mage");
    const guides = section(mage, "guides");
    expect(guides).toContain('href="/guides/frost-leveling"');
    expect(visible(guides)).toContain("Frost leveling");
    expect(visible(guides)).toContain("A Mage plan for levels 10 to 60.");
    expect(visible(guides)).toContain("Leveling · Levels 10–60 · Damage");
    for (const other of ["Fire draft", "fire-draft", "Warrior tanking"]) expect(mage, other).not.toContain(other);
    expect(visible(mage)).not.toContain("No Mage guide is reviewed yet.");
    expect(ledeOf(mage)).toContain("1 reviewed Mage guide, the talent calculator");
    expect(visible(section(await hub("warrior"), "guides"))).toContain("Dungeons · Levels 20–60 · Tank, Damage");
    expect(visible(await hub("priest"))).toContain("No Priest guide is reviewed yet.");
    expect((await hubMetadata("mage")).robots).toEqual({ index: true, follow: true });
    expect((await hubMetadata("warrior")).robots).toEqual({ index: true, follow: true });
    expect((await hubMetadata("priest")).robots).toEqual({ index: false, follow: true });
  });

  test("every hub's title and description fit, with and without reviewed guides", async () => {
    for (const guides of [[], SOME, TALENT_CLASSES.flatMap((c, i) => [0, 1].map((n) => ({ slug: `${c}-${n}`, title: `Guide ${i}.${n}`, classSlug: c })))]) {
      stubGuides(guides);
      for (const slug of TALENT_CLASSES) complete(`/classes/${slug}`, await hubMetadata(slug));
      complete("/classes", await indexRoute.generateMetadata());
    }
  });

  test("the hub links the calculator, the database and dungeon preparation, through pages that exist", async () => {
    const page = section(await hub("mage"), "plan");
    const links = contextLinks({ classSlug: "mage" }).filter((l) => l.key !== "hub");
    for (const link of links) expect(page, link.key).toContain(`href="${link.href}"`);
    expect(page).not.toContain("/tools/talents/warrior");
    // The page is built once, so its links cannot carry a level or role from the address. They need not: none of
    // their pages reads one yet. Once contextLinks carries one to a page, this fails, and the hub has to draw that
    // link from the address on the client.
    expect(contextLinks({ classSlug: "mage", level: 25, role: "damage" }).filter((l) => l.key !== "hub")).toEqual(links);
  });

  test("who can be the class comes from Blizzard's race table, with the new combinations marked", async () => {
    expect(classRaces("mage")).toEqual([
      { faction: "Horde", races: [{ race: "Orc", isNew: true }, { race: "Troll", isNew: false }, { race: "Undead", isNew: false }] },
      { faction: "Alliance", races: [{ race: "Gnome", isNew: false }, { race: "Human", isNew: false }, { race: "Skyborne", isNew: false }] },
    ]);
    expect(classRaces("druid").map((f) => [f.faction, f.races.map((r) => r.race)])).toEqual([["Horde", ["Tauren", "Skyborne"]], ["Alliance", ["Night Elf", "Skyborne"]]]);
    const races = section(await hub("mage"), "races");
    for (const race of ["Orc", "Troll", "Undead", "Gnome", "Human", "Skyborne"]) expect(visible(races), race).toContain(race);
    for (const race of ["Tauren", "Dwarf", "Night Elf"]) expect(visible(races), race).not.toContain(race);
    expect(races).toContain('href="/wow-forever#races"');
  });

  test("no header or Tools menu link points at the class pages yet", () => {
    const hrefs = [...PRIMARY.map((l) => l.href), ...[false, true].flatMap((guilds) => toolGroups(guilds).flatMap((g) => g.links.map((l) => l.href)))];
    expect(hrefs.filter((h) => h === "/classes" || h.startsWith("/classes/"))).toEqual([]);
  });
});

describe("the class index", () => {
  const row = (html: string, slug: string) => html.match(new RegExp(`<tr[^>]*>(?:(?!</tr>)[\\s\\S])*href="/classes/${slug}"[\\s\\S]*?</tr>`))?.[0] ?? "";

  test("lists the nine hubs with their reviewed guides, and stays out of search until one has a guide", async () => {
    const empty = await index();
    for (const slug of TALENT_CLASSES) expect(empty, slug).toContain(`href="/classes/${slug}"`);
    expect(visible(empty)).toContain("No class guide is reviewed yet.");
    expect(ledeOf(empty)).not.toMatch(/guide/i);
    expect((await indexRoute.generateMetadata()).robots).toEqual({ index: false, follow: true });

    stubGuides(SOME);
    const listed = await index();
    expect(visible(row(listed, "mage"))).toMatch(/Mage\s+1\b/);
    expect(visible(row(listed, "warrior"))).toMatch(/Warrior\s+1\b/);
    expect(visible(row(listed, "priest"))).not.toMatch(/\d/);
    expect(visible(listed)).not.toContain("No class guide is reviewed yet.");
    expect((await indexRoute.generateMetadata()).robots).toEqual({ index: true, follow: true });
  });
});

/* ---------- On this browser ---------- */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function mount(el: ReactNode) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (root) await act(async () => root!.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(el));
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

const text = () => (container?.textContent ?? "").replace(/\s+/g, " ");
const button = (label: string) => [...container!.querySelectorAll("button")].find((b) => b.textContent === label) ?? null;
const link = (label: string) => [...container!.querySelectorAll("a")].find((a) => a.textContent === label) ?? null;
const click = async (label: string) => {
  const b = button(label);
  expect(b, label).not.toBeNull();
  await act(async () => b!.click());
};
const saved = () => JSON.parse(localStorage.getItem(CLASS_CONTEXT_SLOT) ?? "null");

describe("remembering a class on this browser", () => {
  test("keeps the hub's class with the link's level and role, says so once the browser kept them, and forgets on request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    address.search = "level=25&role=damage";
    await mount(<UseClassButton classSlug="mage" />);
    expect(text()).toContain("From this link: level 25, damage.");
    expect(link("Show Mage without them")?.getAttribute("href")).toBe("/classes/mage");
    await click("Remember Mage, level 25, damage on this browser");
    expect(saved()).toEqual({ classSlug: "mage", level: 25, role: "damage" });
    expect(container!.querySelector('[role="status"]')?.textContent).toBe("Remembered on this browser.");
    await click("Forget");
    expect(saved()).toBeNull();
    expect(button("Remember Mage, level 25, damage on this browser")).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a class this browser remembers never replaces the class, level or role the link opens", async () => {
    localStorage.setItem(CLASS_CONTEXT_SLOT, JSON.stringify({ classSlug: "warrior", level: 20 }));
    await mount(<UseClassButton classSlug="mage" />);
    expect(text()).toContain("This browser remembers Warrior, level 20.");
    expect(link("Open it")?.getAttribute("href")).toBe("/classes/warrior?level=20");
    expect(button("Remember Mage instead")).not.toBeNull();
    expect(saved()).toEqual({ classSlug: "warrior", level: 20 });
    // The page itself is the link's class whatever the browser remembers.
    const page = await hub("mage");
    expect(page).toContain('href="/tools/talents/mage"');
    expect(page).not.toContain("warrior?level=20");

    // A remembered level for the same class is offered, not added to this link's context.
    localStorage.setItem(CLASS_CONTEXT_SLOT, JSON.stringify({ classSlug: "mage", level: 40 }));
    await mount(<UseClassButton classSlug="mage" />);
    expect(text()).toContain("This browser remembers Mage, level 40.");
    expect(text()).not.toContain("From this link");
    await click("Remember Mage instead");
    expect(saved()).toEqual({ classSlug: "mage" });
  });

  test("a browser that will not keep it never shows it as kept", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    await mount(<UseClassButton classSlug="mage" />);
    await click("Remember Mage on this browser");
    expect(text()).not.toContain("Remembered on this browser.");
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe("This browser did not keep it: its site storage is off or full.");
    expect(saved()).toBeNull();
    expect(button("Remember Mage on this browser")).not.toBeNull();
  });

  test("a link's level or role that cannot be read is named and left out, and the class still opens", async () => {
    address.search = "level=99&role=damage";
    await mount(<UseClassButton classSlug="mage" />);
    expect(text()).toContain('"99" is not a level from 1 to 60. This page leaves the link\'s level and role out.');
    expect(text()).not.toContain("From this link");
    expect(button("Remember Mage on this browser")).not.toBeNull();
  });

  test("the class index offers the remembered class as a link, and moves nobody", async () => {
    const before = window.location.href;
    localStorage.setItem(CLASS_CONTEXT_SLOT, JSON.stringify({ classSlug: "mage", level: 25 }));
    await mount(<RememberedClass />);
    expect(text()).toContain("Remembered on this browser:");
    expect(link("Mage, level 25")?.getAttribute("href")).toBe("/classes/mage?level=25");
    expect(window.location.href).toBe(before);
    for (const stale of [null, JSON.stringify({ classSlug: "deathknight" })]) {
      if (stale) localStorage.setItem(CLASS_CONTEXT_SLOT, stale); else localStorage.clear();
      await mount(<RememberedClass />);
      expect(container!.innerHTML, String(stale)).toBe("");
    }
  });
});
