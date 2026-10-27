// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
// The app router reports the browser's own address.
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
}));
// The game files' spell names and profession icons, the class talent catalogs (withdrawn when a test says so), and an
// upload store with no reports.
const files = vi.hoisted(() => ({
  spells: null as { version: string; names: Map<number, string> } | null,
  professions: [] as { key: string; name: string; icon: string }[],
  withdrawn: false,
}));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSpellNames: async () => files.spells,
  classAndProfessionIcons: () => ({ classes: [], professions: files.professions }),
}));
vi.mock("@/lib/talents/catalogs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/talents/catalogs")>();
  return {
    ...real,
    loadCatalog: async (slug: Parameters<typeof real.loadCatalog>[0]) => {
      if (files.withdrawn) throw new Error("withdrawn");
      return real.loadCatalog(slug);
    },
  };
});
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: async () => ({ records: [], unreachable: false, dataAsOf: "2026-10-26T00:00:00.000Z" }) },
}));
vi.mock("@/components/EmailCapture", () => ({ default: () => null }));

import ClassContextChip, { ClassContextChipFromAddress } from "./ClassContextChip";
import SpellListPage, { generateMetadata as spellMetadata } from "@/app/database/spells/page";
import RaidPage from "@/app/tools/raid/page";
import ProfessionsPage from "@/app/tools/professions/page";
import { CLASS_CONTEXT_SLOT, type ClassContext, type ContextRead } from "@/lib/class-context";
import { loadCatalog } from "@/lib/talents/catalogs";

const full: ClassContext = { classSlug: "mage", level: 25, role: "damage" };
const read = (context: ClassContext | null): ContextRead => ({ ok: true, context });

/** The text a reader sees: no scripts, and without the parts a selector names (the chip, say). */
function visible(html: string, without?: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(`script${without ? `, ${without}` : ""}`).forEach((n) => n.remove());
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

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

const text = () => (container?.textContent ?? "").replace(/\s+/g, " ");
/** The link whose text (a screen reader's words included) holds `words`. */
const anchor = (words: string) => [...container!.querySelectorAll("a")].find((a) => a.textContent?.includes(words)) ?? null;

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
  files.spells = null;
  files.professions = [];
  files.withdrawn = false;
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("the class context chip", () => {
  test("names the address's context with a link to its hub, and its cross takes the context off and nothing else", async () => {
    await mount(<ClassContextChip read={read(full)} here="/database/items?quality=epic">What it does here.</ClassContextChip>);
    expect(anchor("Mage, level 25, damage")?.getAttribute("href")).toBe("/classes/mage?level=25&role=damage");
    expect(anchor("Remove Mage, level 25, damage")?.getAttribute("href")).toBe("/database/items?quality=epic");
    expect(text()).toContain("What it does here.");
  });

  test("a class this browser remembers is offered beside the address's context, never in its place", async () => {
    localStorage.setItem(CLASS_CONTEXT_SLOT, JSON.stringify({ classSlug: "warrior", level: 20 }));
    await mount(<ClassContextChip read={read(full)} here="/database/items?quality=epic" />);
    expect(anchor("Mage, level 25, damage")?.getAttribute("href")).toBe("/classes/mage?level=25&role=damage");
    expect(text()).toContain("This browser remembers Warrior, level 20.");
    // Using it swaps the context and keeps the page's filters.
    expect(anchor("Use it")?.getAttribute("href")).toBe("/database/items?quality=epic&class=warrior&level=20");
    expect(JSON.parse(localStorage.getItem(CLASS_CONTEXT_SLOT)!)).toEqual({ classSlug: "warrior", level: 20 });

    // The address's own context remembered is not offered again.
    localStorage.setItem(CLASS_CONTEXT_SLOT, JSON.stringify(full));
    await mount(<ClassContextChip read={read(full)} here="/database/items?quality=epic" />);
    expect(text()).not.toContain("This browser remembers");
  });

  test("using a remembered class starts the list on its first page and keeps the search and sort; the cross keeps the page", async () => {
    localStorage.setItem(CLASS_CONTEXT_SLOT, JSON.stringify(full));
    await mount(<ClassContextChip read={read(null)} here="/database/spells?q=fire&sort=name&page=3" />);
    expect(anchor("Use it")?.getAttribute("href")).toBe("/database/spells?q=fire&sort=name&class=mage&level=25&role=damage");
    await mount(<ClassContextChip read={read({ classSlug: "warrior" })} here="/database/spells?q=fire&sort=name&page=3" />);
    expect(anchor("Remove Warrior")?.getAttribute("href")).toBe("/database/spells?q=fire&sort=name&page=3");
    expect(anchor("Use it")?.getAttribute("href")).toBe("/database/spells?q=fire&sort=name&class=mage&level=25&role=damage");
  });

  test("with no context in the address, a remembered class is only offered", async () => {
    localStorage.setItem(CLASS_CONTEXT_SLOT, JSON.stringify({ classSlug: "druid", role: "healer" }));
    const chip = <ClassContextChip read={read(null)} here="/database/spells?q=moon">What it does here.</ClassContextChip>;
    // The markup sent from the server holds nothing: the browser's storage is read after it.
    expect(renderToStaticMarkup(chip)).toBe("");
    await mount(chip);
    expect(text()).toContain("This browser remembers Druid, healer.");
    expect(anchor("Use it")?.getAttribute("href")).toBe("/database/spells?q=moon&class=druid&role=healer");
    expect(text()).not.toContain("What it does here.");
    expect(container!.querySelector('a[href^="/classes/"]')).toBeNull();
  });

  test("a stale remembered class, or storage the browser refuses, offers nothing and changes nothing", async () => {
    for (const stale of ["not json", JSON.stringify({ classSlug: "deathknight" }), JSON.stringify({ classSlug: "mage", level: 99 }), JSON.stringify({ classSlug: "mage", spec: "frost" })]) {
      localStorage.setItem(CLASS_CONTEXT_SLOT, stale);
      await mount(<ClassContextChip read={read(null)} here="/tools/professions" />);
      expect(container!.innerHTML, stale).toBe("");
    }
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
    await mount(<ClassContextChip read={read(full)} here="/tools/professions" />);
    expect(text()).toContain("Mage, level 25, damage");
    expect(text()).not.toContain("remembers");
  });

  test("a context the page cannot read is named with its reason, left out, and can be taken off the address", async () => {
    await mount(<ClassContextChip read={{ ok: false, error: '"deathknight" is not one of the nine classes.' }} here="/database/spells?q=moon">What it does here.</ClassContextChip>);
    expect(text()).toContain('"deathknight" is not one of the nine classes. This page leaves the class out.');
    expect(anchor("Remove it")?.getAttribute("href")).toBe("/database/spells?q=moon");
    expect(text()).not.toContain("What it does here.");
  });
});

describe("on the raid planner, a page built once", () => {
  test("the chip reads the address in the browser and takes the context off in place, keeping the raid in the address", async () => {
    history.replaceState(null, "", "/tools/raid?class=mage&level=25#raid=ELR1-abc");
    const push = vi.spyOn(history, "pushState");
    await mount(<ClassContextChipFromAddress />);
    expect(anchor("Mage, level 25")?.getAttribute("href")).toBe("/classes/mage?level=25");
    const remove = anchor("Remove Mage, level 25")!;
    // The real href holds the raid too, so a new tab or a copied link opens the same raid.
    expect(remove.getAttribute("href")).toBe("/tools/raid#raid=ELR1-abc");
    await act(async () => remove.click());
    // The page is the same for every address, so nothing loads: the address changes, the raid's #fragment kept.
    expect(push).toHaveBeenCalledTimes(1);
    expect(`${location.pathname}${location.search}${location.hash}`).toBe("/tools/raid#raid=ELR1-abc");
    await mount(<ClassContextChipFromAddress />);
    expect(container!.innerHTML).toBe("");
  });

  test("the chip's links follow the raid's #fragment as it changes, and a modified or middle click is left to the browser", async () => {
    history.replaceState(null, "", "/tools/raid?class=mage&level=25#raid=ELR1-abc");
    const push = vi.spyOn(history, "pushState");
    await mount(<ClassContextChipFromAddress />);
    const remove = anchor("Remove Mage, level 25")!;
    // The planner rewrites the fragment without an event; the link catches up before it can be used.
    history.replaceState(null, "", "/tools/raid?class=mage&level=25#raid=ELR1-xyz");
    await act(async () => { remove.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); });
    expect(remove.getAttribute("href")).toBe("/tools/raid#raid=ELR1-xyz");
    history.replaceState(null, "", "/tools/raid?class=mage&level=25#raid=ELR1-new");
    await act(async () => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(remove.getAttribute("href")).toBe("/tools/raid#raid=ELR1-new");
    // A new tab, a new window, a download or a middle click: the browser opens the real href, and this tab stays.
    const before = location.href;
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      let prevented: boolean | null = null;
      // After the page's own handlers; jsdom cannot open a tab, so the test stops it there.
      window.addEventListener("click", (e) => { prevented = e.defaultPrevented; e.preventDefault(); }, { once: true });
      await act(async () => { remove.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init })); });
      expect(prevented, JSON.stringify(init)).toBe(false);
    }
    expect(push).not.toHaveBeenCalled();
    expect(location.href).toBe(before);
  });

  test("the planner shows the chip under its title, and no chip for an address without a class", async () => {
    history.replaceState(null, "", "/tools/raid?class=warrior&role=tank");
    const page = renderToStaticMarkup(await RaidPage());
    expect(page.indexOf("data-class-context")).toBeGreaterThan(page.indexOf("</h1>"));
    expect(page).toContain('href="/classes/warrior?role=tank"');
    history.replaceState(null, "", "/tools/raid");
    const plain = renderToStaticMarkup(await RaidPage());
    expect(plain).not.toContain("data-class-context");
    expect(visible(page, "[data-class-context]")).toBe(visible(plain));
  });
});

describe("the spell list", () => {
  const BANDAGE = 3275;
  /** Names for three spells of the Mage talent catalog and one no talent has. */
  async function names(): Promise<number[]> {
    const ids = [...new Set((await loadCatalog("mage")).nodes.flatMap((n) => n.entries.map((e) => e.spellId)).filter((id): id is number => id !== null))].slice(0, 3);
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain(BANDAGE);
    files.spells = { version: "1.60.1.70630", names: new Map([...ids.map((id, i): [number, string] => [id, `Talent spell ${i}`]), [BANDAGE, "Linen Bandage"]]) };
    return ids;
  }
  const spells = async (search: Record<string, string> = {}) => renderToStaticMarkup(await SpellListPage({ searchParams: Promise.resolve(search) }));
  const rows = (html: string) => html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"));

  test("a class narrows the list to the spells in its talent catalog, named as exactly that subset", async () => {
    const ids = await names();
    const page = await spells({ class: "mage" });
    for (const id of ids) expect(page).toContain(`href="/database/spells/${id}"`);
    expect(page).not.toContain(`href="/database/spells/${BANDAGE}"`);
    expect(visible(page)).toContain("Spells in the Mage talent catalog only, not every Mage spell.");
    expect(page).toContain(`Spells in the Mage talent catalog: ${ids.length}`);
    const all = await spells();
    expect(all).toContain(`href="/database/spells/${BANDAGE}"`);
    expect(all).not.toContain("data-class-context");
  });

  test("the talent catalog subset carries the quiet unconfirmed marker beside its explanation", async () => {
    await names();
    const chip = (html: string) => new DOMParser().parseFromString(html, "text/html").querySelector("[data-class-context]")!;
    const subset = chip(await spells({ class: "mage" }));
    expect(subset.textContent).toContain("Spells in the Mage talent catalog only, not every Mage spell.");
    expect(subset.querySelector('[data-badge="files"]')?.getAttribute("title")).toBe("From the game files, not yet confirmed by players");
    // Listing every spell because the catalog could not be read is no catalog fact, and carries no marker.
    files.withdrawn = true;
    expect(chip(await spells({ class: "mage" })).querySelector('[data-badge="files"]')).toBeNull();
  });

  test("a remembered class used from a later page opens the first page of its subset, not a page the subset lacks", async () => {
    const catalog = [...new Set((await loadCatalog("mage")).nodes.flatMap((n) => n.entries.map((e) => e.spellId)).filter((id): id is number => id !== null))];
    files.spells = { version: "1.60.1.70630", names: new Map([...catalog.map((id): [number, string] => [id, `Talent ${id}`]), ...Array.from({ length: 150 }, (_, n): [number, string] => [9_000_000 + n, `Other ${n}`])]) };
    await spells({ sort: "name", page: "3" });
    localStorage.setItem(CLASS_CONTEXT_SLOT, JSON.stringify(full));
    await mount(<ClassContextChip read={read(null)} here="/database/spells?sort=name&page=3" />);
    const target = new URL(anchor("Use it")!.getAttribute("href")!, "https://everloot.app");
    expect(await spells(Object.fromEntries(target.searchParams))).toContain(`Spells in the Mage talent catalog: ${catalog.length}`);
  });

  test("the list's own links and name box keep the context; taking it off keeps the name search and the sort", async () => {
    await names();
    const page = await spells({ q: "spell", sort: "name", class: "mage", level: "25" });
    expect(page).toContain('href="/database/spells?q=spell&amp;sort=name"');
    expect(page).toMatch(/href="\/database\/spells\?q=spell&amp;sort=-?(name|id)&amp;class=mage&amp;level=25"/);
    expect(page).toMatch(/<input[^>]*name="class"[^>]*value="mage"/);
    expect(page).toMatch(/<input[^>]*name="level"[^>]*value="25"/);
  });

  test("a level or a role narrows nothing: the spells are the same for every level and role", async () => {
    await names();
    const base = rows(await spells({ class: "mage" }));
    for (const search of [{ class: "mage", role: "tank" }, { class: "mage", role: "damage", level: "10" }, { class: "mage", level: "60" }] as Record<string, string>[]) {
      expect(rows(await spells(search)), JSON.stringify(search)).toBe(base);
    }
  });

  test("a withdrawn talent catalog falls back to every spell and says so", async () => {
    await names();
    files.withdrawn = true;
    const page = await spells({ class: "mage" });
    expect(page).toContain(`href="/database/spells/${BANDAGE}"`);
    expect(visible(page)).toContain("The Mage talent catalog could not be read, so every spell is listed.");
    expect(visible(page)).not.toContain("not every Mage spell");
  });

  test("a class the page cannot read narrows nothing, says why, and is not a 404", async () => {
    await names();
    const page = await spells({ class: "deathknight", q: "linen" });
    expect(page).toContain(`href="/database/spells/${BANDAGE}"`);
    expect(visible(page)).toContain('"deathknight" is not one of the nine classes. This page leaves the class out.');
    expect(page).toContain('href="/database/spells?q=linen"');
    expect(page).not.toContain("class=deathknight");
  });

  test("an address with a context is noindex, with the plain list as its canonical", async () => {
    for (const search of [{ class: "mage" }, { class: "mage", level: "25", role: "damage" }, { class: "deathknight" }, { class: "mage", page: "2" }]) {
      const m = await spellMetadata({ searchParams: Promise.resolve(search) });
      expect(m.robots, JSON.stringify(search)).toMatchObject({ index: false, follow: true });
      expect(m.alternates?.canonical, JSON.stringify(search)).toBe("/database/spells");
    }
    expect((await spellMetadata({ searchParams: Promise.resolve({}) })).robots).toBeUndefined();
  });
});

describe("the profession hubs", () => {
  const page = async (search: Record<string, string>) => renderToStaticMarkup(await ProfessionsPage({ searchParams: Promise.resolve(search) }));

  test("a class context is a chip and nothing more: the paths are the same, and the page's links and form keep it", async () => {
    files.professions = [{ key: "Tailoring", name: "Tailoring", icon: "https://assets.test/tailoring.png" }, { key: "Alchemy", name: "Alchemy", icon: "https://assets.test/alchemy.png" }];
    const withContext = await page({ profession: "Tailoring", from: "1", to: "75", class: "mage", level: "25" });
    const plain = await page({ profession: "Tailoring", from: "1", to: "75" });
    expect(withContext).toContain('href="/classes/mage?level=25"');
    // The cross keeps the profession and the skill range.
    expect(withContext).toContain('href="/tools/professions?profession=Tailoring&amp;from=1&amp;to=75"');
    // The profession picker and the form carry the context on.
    expect(withContext).toContain('href="/tools/professions?profession=Alchemy&amp;from=1&amp;to=75&amp;class=mage&amp;level=25"');
    expect(withContext).toMatch(/<input[^>]*name="class"[^>]*value="mage"/);
    expect(withContext).toMatch(/<input[^>]*name="level"[^>]*value="25"/);
    // Nothing else says anything about the class: no skill-up claim for a Mage.
    expect(visible(withContext, "[data-class-context]")).toBe(visible(plain));
    expect(plain).not.toContain("data-class-context");
  });
});
