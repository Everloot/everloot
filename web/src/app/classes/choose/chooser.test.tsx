// @vitest-environment jsdom
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  useSearchParams: () => new URLSearchParams(),
}));

import ChooserPage, * as route from "./page";
import ClassesPage from "../page";
import ClassHubPage, * as hubRoute from "../[class]/page";
import { PRIMARY } from "@/components/Header";
import { toolGroups } from "@/data/tools";
import { scrubEvent, stripFragment } from "@/lib/analytics/load";
import { guidesDir } from "@/lib/guides";
import { DESCRIPTION_MAX, DESCRIPTION_MIN } from "@/lib/seo";

/* ---------- The chooser's files: the committed ones, or made-up ones in a folder of their own ---------- */

const committed = (name: string) => readFileSync(join(guidesDir(), name), "utf8");
const ROLES = committed("class-roles.yaml");
const CHOOSER = committed("class-chooser.yaml");
const reviewed = (source: string) =>
  source.replace("status: draft", "status: reviewed").replace('reviewer: ""', "reviewer: Kai").replace("reviewedOn: null", "reviewedOn: 2026-10-26");

/** A folder with these chooser files and no guides, pointed at through GUIDES_DIR. */
function stubFiles(files: Record<string, string>): void {
  const dir = mkdtempSync(join(tmpdir(), "chooser-files-"));
  for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source);
  vi.stubEnv("GUIDES_DIR", dir);
}

/* ---------- The page in a browser ---------- */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

/** The page at /classes/choose with this fragment, as a browser opens it. */
async function open(hash = "") {
  history.replaceState(null, "", `/classes/choose${hash}`);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (root) await act(async () => root!.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<ChooserPage />));
}

/** The words of built markup, as a reader sees them. */
const visible = (html: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script").forEach((s) => s.remove());
  return (doc.body.textContent ?? "").replace(/\s+/g, " ");
};
const words = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const section = (id: string) => container!.querySelector(`[aria-labelledby="${id}"]`);
const result = () => words(section("result"));
const button = (label: string) => [...container!.querySelectorAll("button")].find((b) => words(b) === label) ?? null;
const press = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => el!.click());
};
/** Picks an answer the way a player does: the radio button with this label in the question with this legend. */
const pick = async (legend: string, label: string) => {
  const fieldset = [...container!.querySelectorAll("fieldset")].find((f) => words(f.querySelector("legend")) === legend);
  const radio = [...(fieldset?.querySelectorAll("label") ?? [])].find((l) => words(l) === label)?.querySelector("input");
  await press(radio ?? null);
};
const chooseRace = async (key: string) => {
  const select = container!.querySelector<HTMLSelectElement>('select[name="race"]')!;
  await act(async () => {
    select.value = key;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
};
const hubLinks = () => [...section("result")!.querySelectorAll<HTMLAnchorElement>("a")].map((a) => a.getAttribute("href"));

const NO_RANKING = /\b(best|tier|meta|strongest|weakest|popular|ranking|score|census|dps)\b/;

beforeEach(() => vi.unstubAllEnvs());
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  delete (window as { posthog?: unknown }).posthog;
  delete (window as { gtag?: unknown }).gtag;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the chooser page", () => {
  test("is its own page, built once per deploy, while a class hub still refuses the address", async () => {
    expect(route.dynamic).toBe("error");
    expect(hubRoute.generateStaticParams().map((p) => p.class)).not.toContain("choose");
    await expect(ClassHubPage({ params: Promise.resolve({ class: "choose" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  test("while its files are drafts it says so before anything else and stays out of search", async () => {
    const m = await route.generateMetadata();
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.alternates?.canonical).toBe("/classes/choose");
    expect(String(m.title)).toBe("WoW Forever Class Chooser");
    expect(String(m.description).length, String(m.description)).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
    expect(String(m.description).length, String(m.description)).toBeLessThanOrEqual(DESCRIPTION_MAX);
    const html = renderToStaticMarkup(<ChooserPage />);
    const page = visible(html);
    expect(page).toContain("Draft for review: not reviewed yet");
    expect(page.indexOf("Draft for review")).toBeLessThan(page.indexOf("Is there a race you want to play?"));
    expect(page).toContain("No one has reviewed them yet");
    expect(page).not.toContain("Reviewed by");
  });

  test("once both files are reviewed the note goes, the reviews are named, and the plain page may be found", async () => {
    stubFiles({ "class-roles.yaml": reviewed(ROLES), "class-chooser.yaml": reviewed(CHOOSER) });
    expect((await route.generateMetadata()).robots).toEqual({ index: true, follow: true });
    const page = visible(renderToStaticMarkup(<ChooserPage />));
    expect(page).not.toContain("Draft for review");
    expect(page).toContain("Weights version 1, reviewed by Kai on 2026-10-26");
    expect(page).toContain("Facts version 1, reviewed by Kai on 2026-10-26");
  });

  test("one reviewed file is not enough: the chooser stays a draft", async () => {
    stubFiles({ "class-roles.yaml": reviewed(ROLES), "class-chooser.yaml": CHOOSER });
    expect((await route.generateMetadata()).robots).toEqual({ index: false, follow: true });
    expect(visible(renderToStaticMarkup(<ChooserPage />))).toContain("Draft for review: not reviewed yet");
  });

  test("files that break a rule, or are missing, show no chooser and stay out of search", async () => {
    const broken: Record<string, string>[] = [{ "class-roles.yaml": ROLES.replace("status: draft", "status: reviewed"), "class-chooser.yaml": CHOOSER }, { "class-roles.yaml": ROLES }];
    for (const files of broken) {
      stubFiles(files);
      expect((await route.generateMetadata()).robots).toEqual({ index: false, follow: true });
      const html = renderToStaticMarkup(<ChooserPage />);
      expect(visible(html)).toContain("The class chooser is not available: its files do not pass their check.");
      expect(html).not.toContain("<form");
    }
  });

  test("is linked from no header, Tools menu, class index or hub while it is a draft", async () => {
    const hrefs = [...PRIMARY.map((l) => l.href), ...[false, true].flatMap((guilds) => toolGroups(guilds).flatMap((g) => g.links.map((l) => l.href)))];
    expect(hrefs.filter((h) => h.startsWith("/classes"))).toEqual([]);
    const pages = [renderToStaticMarkup(<ClassesPage />), renderToStaticMarkup(await ClassHubPage({ params: Promise.resolve({ class: "mage" }) }))];
    for (const html of pages) expect(html).not.toContain("/classes/choose");
  });

  test("shows every weight with its reason, and what the chooser does not know", () => {
    const page = visible(renderToStaticMarkup(<ChooserPage />));
    for (const line of [
      "What would you like to do in a group?", "Which of these draws you in?", "Effects that strengthen my group",
      "Heal my allies +2 for each class the source says heals.",
      "Paladin: Blizzard's article says paladins call upon the Light to heal wounds.",
      "Protect my group +2 for each class the source says protects a group. No class: the source does not say which classes protect a group.",
      "Rogue: +2. Blizzard's article says rogues rely on stealth and are fond of poisons.",
      "Priest: +1. Power Word: Fortitude, Divine Spirit and Shadow Protection, in the raid builder's table.",
      "A race keeps the classes Blizzard's race tables let it be, and adds no weight.",
    ]) expect(page, line).toContain(line);
    for (const limit of [
      "The weights are Everloot's editorial choices, not measurements",
      "The source does not say which classes protect a group.",
      "It describes Druids, Hunters and Shaman without naming a role",
      "Classes with the same weight are shown together, in alphabetical order. The chooser does not break a tie.",
      "Your answers stay in this page's address, after the # sign",
    ]) expect(page, limit).toContain(limit);
    expect(page.toLowerCase()).not.toMatch(NO_RANKING);
  });

  test("as built, the buttons wait for the browser, and the page says the chooser needs JavaScript", () => {
    const html = renderToStaticMarkup(<ChooserPage />);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html).toContain("<noscript>");
    expect(html).toContain("needs JavaScript");
  });
});

describe("choosing in the browser", () => {
  test("with nothing answered it asks for an answer and shows no class", async () => {
    await open();
    expect(result()).toContain("Answer at least one question");
    expect(hubLinks()).toEqual([]);
  });

  test("a link's answers show the class they fit most, with the reasons, linking its hub and carrying no answer there", async () => {
    await open("#theme=frost-and-flame&companion=demon");
    expect(result()).toContain("Mage and Warlock fit your answers equally");
    await open("#theme=frost-and-flame");
    expect(result()).toContain("Mage fits your answers most");
    expect(result()).toContain("Frost and flame, from a distance: +2. Blizzard's article says mages rarely fight in melee");
    expect(hubLinks()).toContain("/classes/mage");
    for (const href of hubLinks()) expect(href, href!).toMatch(/^\/classes\/[a-z]+$/);
  });

  test("answering and showing puts the answers in the address's fragment, never its query, and moves focus to the result", async () => {
    await open();
    await chooseRace("horde-tauren");
    await pick("What would you like to do in a group?", "Deal damage");
    await pick("Which of these draws you in?", "Weapons and armed combat");
    await press(button("Show the classes that fit"));
    expect(location.search).toBe("");
    expect(location.hash).toBe("#race=horde-tauren&role=damage&theme=weapons");
    expect(document.activeElement?.id).toBe("result");
    expect(result()).toContain("Warrior fits your answers most");
    expect(result()).toContain("A Tauren cannot be a Mage, Paladin, Priest, Rogue or Warlock in Blizzard's tables");
  });

  test("a tie is shown together, in alphabetical order, and the page says no tie is broken", async () => {
    await open("#role=heal");
    expect(result()).toContain("Paladin and Priest fit your answers equally");
    expect(result()).toContain("They tie on your answers. Tied classes are listed in alphabetical order; the chooser does not break a tie.");
  });

  test("an answer that weighs no class says why", async () => {
    await open("#role=protect");
    expect(result()).toContain('"Protect my group" gives weight to no class: the source does not say which classes protect a group.');
    await open("#race=horde-tauren&theme=frost-and-flame");
    expect(result()).toContain('"Frost and flame, from a distance" gives weight to no class a Tauren can be.');
    expect(result()).toContain("A Tauren can be a Druid, Hunter, Shaman or Warrior");
  });

  test("a link it cannot read says why, keeps none of it, and shows no answers", async () => {
    await open("#role=wizard&theme=frost-and-flame");
    expect(words(container!.querySelector('[role="alert"]'))).toContain('The link answers "What would you like to do in a group?" with "wizard", which is not one of its answers.');
    expect(location.hash).toBe("");
    expect(result()).toContain("Answer at least one question");
  });

  test("a link pasted into the address bar is read again", async () => {
    await open("#role=heal");
    history.replaceState(null, "", "/classes/choose#theme=stealth");
    await act(async () => window.dispatchEvent(new HashChangeEvent("hashchange")));
    expect(result()).toContain("Rogue fits your answers most");
    expect(container!.querySelector<HTMLInputElement>('input[name="theme"][value="stealth"]')?.checked).toBe(true);
  });

  test("Start again clears the answers and the address", async () => {
    await open("#role=heal&theme=faith");
    await press(button("Start again"));
    expect(location.hash).toBe("");
    expect(result()).toContain("Answer at least one question");
    expect(container!.querySelector<HTMLInputElement>('input[name="theme"][value="faith"]')?.checked).toBe(false);
  });

  test("answers go to no analytics: nothing is sent, and a page view of the result keeps no answer", async () => {
    const capture = vi.fn();
    const gtag = vi.fn();
    Object.assign(window, { posthog: { capture }, gtag });
    await open();
    await pick("What would you like to do in a group?", "Heal my allies");
    await press(button("Show the classes that fit"));
    expect(capture).not.toHaveBeenCalled();
    expect(gtag).not.toHaveBeenCalled();
    const url = `https://everloot.app${location.pathname}${location.search}${location.hash}`;
    expect(url).toBe("https://everloot.app/classes/choose#role=heal");
    const sent = scrubEvent({ properties: { $current_url: url } }, "https://everloot.app");
    expect(sent.properties.$current_url).toBe("https://everloot.app/classes/choose");
    expect(stripFragment(url)).toBe("https://everloot.app/classes/choose");
  });

  test("an opened result claims no power and no best class", async () => {
    await open("#race=alliance-human&role=damage&theme=weapons&group=debuffs");
    expect(result().toLowerCase()).not.toMatch(NO_RANKING);
  });
});
