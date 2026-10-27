// @vitest-environment jsdom
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

import GroupPage, * as route from "./page";
import { PRIMARY } from "@/components/Header";
import { CLASSES } from "@/design/tokens";
import { CURRENT_BUILD, TABLES } from "@/data/game-data/raid";
import { toolGroups } from "@/data/tools";
import { classLabel } from "@/lib/class-context";
import { decodeRaid } from "@/lib/raid";
import { DESCRIPTION_MAX, DESCRIPTION_MIN } from "@/lib/seo";
import { fixture } from "@/lib/talents/fixture";
import { encodeBuild, encodeOrder } from "@/lib/talents/share";
import type { Ranks } from "@/lib/talents/types";

/* ---------- Fixture guides, as the class hub tests write them ---------- */

const RANKS: Ranks = { 11: { rank: 5 }, 21: { rank: 1 } };
const PLANNED = encodeOrder(RANKS, [11, 11, 11, 11, 11, 21], "planned")!;

interface FixtureGuide { slug: string; classSlug: string; roles: string; status?: "draft" | "published" }

function guideFile(g: FixtureGuide, id: number): string {
  const published = (g.status ?? "published") === "published";
  return `---
id: ${id}
slug: ${g.slug}
version: 1
status: ${published ? "published" : "draft"}
title: ${g.slug}
summary: "A test guide."
classSlug: ${g.classSlug}
activity: dungeons
roles: ${g.roles}
levels: { from: 10, to: 60 }
code: ${encodeBuild({ classSlug: g.classSlug, specId: fixture.specId, build: fixture.build, ranks: RANKS })}
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
  const dir = mkdtempSync(join(tmpdir(), "group-guides-"));
  guides.forEach((g, i) => writeFileSync(join(dir, `${g.slug}.md`), guideFile(g, i + 1)));
  vi.stubEnv("GUIDES_DIR", dir);
}

/* ---------- The page in a browser ---------- */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

/** The page at /classes/group with this fragment, as a browser opens it. */
async function open(hash = "") {
  history.replaceState(null, "", `/classes/group${hash}`);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (root) await act(async () => root!.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<GroupPage />));
}

/** The words of built markup, as a reader sees them. */
const visible = (html: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script").forEach((s) => s.remove());
  return (doc.body.textContent ?? "").replace(/\s+/g, " ");
};
const text = () => (container?.textContent ?? "").replace(/\s+/g, " ");
const words = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
/** The lines of the section under the heading with this id. */
const items = (id: string) => [...(container!.querySelector(`[aria-labelledby="${id}"]`)?.querySelectorAll("li") ?? [])].map(words);
const members = (party: string) => [...container!.querySelectorAll(`[aria-label="${party}"] [data-member]`)].map((m) => m.getAttribute("data-member"));
const button = (label: string) => [...container!.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label || words(b) === label) ?? null;
const size = (n: number) => [...container!.querySelectorAll<HTMLButtonElement>('[aria-label="Group size"] button')].find((b) => words(b).startsWith(`${n} `) || words(b) === String(n))!;
const link = (label: string) => [...container!.querySelectorAll("a")].find((a) => words(a) === label) ?? null;
const press = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => el!.click());
};
const raidOf = (href: string) => decodeRaid(href.split("#raid=")[1] ?? "");

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  stubGuides([]);
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the group page", () => {
  test("is built once per deploy and stays out of search, and no header or Tools menu link points at it", () => {
    expect(route.dynamic).toBe("error");
    const m = route.metadata;
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.alternates?.canonical).toBe("/classes/group");
    expect(String(m.title)).toMatch(/^WoW Forever /);
    expect(String(m.description).length, String(m.description)).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
    expect(String(m.description).length, String(m.description)).toBeLessThanOrEqual(DESCRIPTION_MAX);
    const hrefs = [...PRIMARY.map((l) => l.href), ...[false, true].flatMap((guilds) => toolGroups(guilds).flatMap((g) => g.links.map((l) => l.href)))];
    expect(hrefs.filter((h) => h.startsWith("/classes"))).toEqual([]);
  });

  test("as built, it is an empty group of five with every class to add, and claims nothing for it", () => {
    const html = renderToStaticMarkup(<GroupPage />);
    for (const c of CLASSES) expect(html, c).toContain(`aria-label="Add ${classLabel(c)}"`);
    expect(visible(html)).toContain("0 of 5 places filled, 5 open");
    expect(visible(html)).toContain("Add a class to see what the group brings.");
    for (const absent of ["Nobody in the group brings", "/tools/raid#raid=", "Not in the group"]) expect(html, absent).not.toContain(absent);
  });

  test("a group link opens its classes in parties of five, and names the classes in it more than once and those not in it", async () => {
    await open("#size=10&classes=mage,mage,priest,warrior,warrior,paladin");
    expect(text()).toContain("6 of 10 places filled, 4 open");
    expect(members("Party 1")).toEqual(["mage", "mage", "priest", "warrior", "warrior"]);
    expect(members("Party 2")).toEqual(["paladin"]);
    expect(text()).toContain("In the group more than once: Warrior (2) and Mage (2).");
    expect(text()).toContain("Not in the group: Hunter, Rogue, Shaman, Warlock and Druid.");
  });

  test("what nobody brings is said as coverage, under the classes that bring it; no class is ranked", async () => {
    await open("#size=5&classes=mage,priest");
    expect(text()).toContain("Nobody in the group brings these.");
    const nobody = items("nobody");
    expect(nobody).toContain("Hunter: Trueshot Aura (Marksmanship talent)");
    const druid = nobody.find((line) => line.startsWith("Druid: "))!;
    for (const effect of ["Mark of the Wild", "Moonkin Aura (Balance talent)", "Leader of the Pack (Feral Combat talent)", "Faerie Fire"]) expect(druid, effect).toContain(effect);
    expect(nobody.map((line) => line.split(":")[0])).toEqual(["Warrior", "Paladin", "Hunter", "Rogue", "Shaman", "Warlock", "Druid"]);
    expect(items("brings").join(" ")).toContain("Arcane Intellect");
    expect(items("talent")).toEqual(["A Mage brings Winter's Chill only with a Frost talent."]);
    expect(text().toLowerCase()).not.toMatch(/\b(best|tier|meta|strongest|weakest|popular|ranking|score|census)\b/);
  });

  test("a party effect reaches only its caster's party, so a party without one is named", async () => {
    await open("#size=10&classes=paladin,warrior,warrior,warrior,warrior,priest");
    expect(items("parties")).toContain("Devotion Aura reaches only its caster's party, and nobody in party 2 brings it.");
    await open("#size=20&classes=paladin");
    expect(items("parties")).toContain("Devotion Aura reaches only its caster's party, and nobody in parties 2, 3 and 4 brings it.");
    await open("#size=5&classes=paladin");
    expect(items("parties")).toEqual([]);
    expect(items("brings").join(" ")).toContain("Devotion Aura");
  });

  test("an effect whose reach the files do not settle is named as not known, not counted as brought", async () => {
    await open("#size=5&classes=paladin");
    expect(items("unknown")).toEqual(["A Paladin brings Blessing of Salvation, but how far it reaches is not known in this build's files."]);
    expect(items("brings").join(" ")).not.toContain("Blessing of Salvation");
  });

  test("the group opens in the raid builder with the same classes, and a group of five says it opens as part of ten", async () => {
    await open("#size=5&classes=mage,mage,priest");
    const href = link("Open this group in the raid builder")?.getAttribute("href") ?? "";
    expect(href.startsWith("/tools/raid#raid=")).toBe(true);
    expect(raidOf(href)).toEqual({
      ok: true,
      value: { size: 10, build: TABLES[CURRENT_BUILD].build, slots: [{ class: "mage", tree: 0 }, { class: "mage", tree: 0 }, { class: "priest", tree: 0 }, ...Array(7).fill(null)] },
    });
    expect(text()).toContain("The raid builder plans 10, 20 or 40 players, so this group of 5 opens there as group 1 of a 10-player raid.");
    expect(text()).toContain("Each player starts there on any talent tree.");

    await open("#size=20&classes=mage");
    const twenty = raidOf(link("Open this group in the raid builder")?.getAttribute("href") ?? "");
    expect(twenty.ok && twenty.value.size).toBe(20);
    expect(text()).not.toContain("opens there as group 1");
  });

  test("adding fills the next place, a full group takes no more, removing frees one, and the address follows", async () => {
    await open();
    for (const c of ["Mage", "Mage", "Priest"]) await press(button(`Add ${c}`));
    expect(location.hash).toBe("#size=5&classes=mage,mage,priest");
    expect(text()).toContain("3 of 5 places filled, 2 open");
    for (const c of ["Warrior", "Rogue"]) await press(button(`Add ${c}`));
    expect(button("Add Druid")?.getAttribute("aria-disabled")).toBe("true");
    await press(button("Add Druid"));
    expect(location.hash).toBe("#size=5&classes=mage,mage,priest,warrior,rogue");
    expect(text()).toContain("All 5 places are filled.");
    await press(button("Remove Mage from party 1, place 1"));
    expect(location.hash).toBe("#size=5&classes=mage,priest,warrior,rogue");
    await press(size(10));
    expect(location.hash).toBe("#size=10&classes=mage,priest,warrior,rogue");
    await press(button("Clear"));
    expect(location.hash).toBe("#size=10");
    expect(text()).toContain("0 of 10 places filled, 10 open");
  });

  test("a size that cannot hold the classes chosen is not taken, so no class is dropped", async () => {
    await open("#size=10&classes=mage,mage,mage,priest,priest,druid");
    expect(size(5).getAttribute("aria-disabled")).toBe("true");
    expect(words(size(5))).toBe("5 players, too few for 6 classes");
    await press(size(5));
    expect(location.hash).toBe("#size=10&classes=mage,mage,mage,priest,priest,druid");
    expect(size(20).getAttribute("aria-disabled")).toBe("false");
  });

  test("a link the page cannot read is named, and the page opens an empty group instead", async () => {
    await open("#size=5&classes=mage,deathknight");
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe('"deathknight" is not one of the nine classes. This page opens an empty group instead.');
    expect(text()).toContain("0 of 5 places filled, 5 open");
    await press(button("Add Mage"));
    expect(container!.querySelector('[role="alert"]')).toBeNull();
  });

  test("anything else a link carries never shows and is dropped from the address; the copied link holds only the size and classes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await open("#size=5&classes=mage&name=Arthas&realm=Dreadmist");
    for (const leak of ["Arthas", "Dreadmist"]) expect(container!.innerHTML, leak).not.toContain(leak);
    expect(location.hash).toBe("#size=5&classes=mage");
    await press([...container!.querySelectorAll("button")].find((b) => words(b).startsWith("Copy link")) ?? null);
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/classes/group#size=5&classes=mage`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a link pasted into the address bar opens its group", async () => {
    await open("#size=5&classes=mage");
    history.replaceState(null, "", "/classes/group#size=10&classes=druid,druid");
    await act(async () => window.dispatchEvent(new HashChangeEvent("hashchange")));
    expect(members("Party 1")).toEqual(["druid", "druid"]);
    expect(text()).toContain("2 of 10 places filled, 8 open");
  });
});

describe("the status line", () => {
  test("is there from the start, polite, and says what each change did and how many places are left", async () => {
    const built = new DOMParser().parseFromString(renderToStaticMarkup(<GroupPage />), "text/html");
    expect(built.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();

    await open();
    const status = container!.querySelector('[role="status"]')!;
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("");
    const says = async (el: HTMLElement | null, line: string) => {
      await press(el);
      expect(container!.querySelector('[role="status"]'), "the same line, never remounted").toBe(status);
      expect(status.textContent).toBe(line);
    };
    await says(button("Add Mage"), "Mage added to party 1. 1 of 5 places filled, 4 open.");
    await says(button("Add Priest"), "Priest added to party 1. 2 of 5 places filled, 3 open.");
    await says(button("Remove Mage from party 1, place 1"), "Mage removed from party 1. 1 of 5 places filled, 4 open.");
    await says(size(10), "Group of 10 players. 1 of 10 places filled, 9 open.");
    for (const c of ["Warrior", "Warrior", "Rogue", "Mage"]) await press(button(`Add ${c}`));
    await says(button("Add Druid"), "Druid added to party 2. 6 of 10 places filled, 4 open.");
    await says(button("Remove Druid from party 2, place 1"), "Druid removed from party 2. 5 of 10 places filled, 5 open.");
    await says(size(5), "Group of 5 players. All 5 places are filled.");
    await says(button("Add Druid"), "All 5 places are filled. Remove a class or choose a larger group to add another.");
    await says(button("Clear"), "Group cleared. 0 of 5 places filled, 5 open.");
  });
});

describe("keyboard focus", () => {
  /** The control with focus, which must be one a keyboard can still use. */
  const focused = () => {
    const el = document.activeElement as HTMLButtonElement | null;
    expect(el && el !== document.body && container!.contains(el), "focus fell out of the planner").toBe(true);
    expect(el!.disabled, "focus is on a disabled control").toBe(false);
    return el!;
  };
  const label = () => focused().getAttribute("aria-label");

  test("filling the group from the keyboard keeps focus on the Add pressed, now unavailable and saying why", async () => {
    await open("#size=5&classes=mage,mage,priest,warrior");
    const add = button("Add Rogue")!;
    add.focus();
    await press(add);
    expect(focused()).toBe(add);
    expect(add.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(add.getAttribute("aria-describedby") ?? "")?.textContent)
      .toBe("All 5 places are filled. Remove a class or choose a larger group to add another.");
    await press(add);
    expect(focused()).toBe(add);
    expect(location.hash).toBe("#size=5&classes=mage,mage,priest,warrior,rogue");
  });

  test("removing the last place filled moves focus to the Remove before it, and an emptied group to that class's Add", async () => {
    await open("#size=10&classes=mage,priest,warrior,warrior,warrior,rogue");
    button("Remove Rogue from party 2, place 1")!.focus();
    await press(focused());
    expect(label()).toBe("Remove Warrior from party 1, place 5");
    // Any other place keeps focus where it was, on the Remove of the class that moved up into it.
    button("Remove Mage from party 1, place 1")!.focus();
    await press(focused());
    expect(label()).toBe("Remove Priest from party 1, place 1");
    button("Remove Warrior from party 1, place 4")!.focus();
    for (const next of ["Remove Warrior from party 1, place 3", "Remove Warrior from party 1, place 2", "Remove Priest from party 1, place 1", "Add Priest"]) {
      await press(focused());
      expect(label()).toBe(next);
    }
    expect(location.hash).toBe("#size=10");
  });

  test("clearing from the keyboard keeps focus on Clear, now unavailable", async () => {
    await open("#size=5&classes=mage,priest");
    const clear = button("Clear")!;
    clear.focus();
    await press(clear);
    expect(focused()).toBe(clear);
    expect(clear.getAttribute("aria-disabled")).toBe("true");
    expect(location.hash).toBe("");
  });
});

describe("roles", () => {
  test("with no reviewed guide, no role is named, none worked out from a class or its talent trees", async () => {
    await open("#size=10&classes=warrior,priest,paladin,druid,shaman,mage");
    expect(items("roles")).toEqual(["Warrior", "Paladin", "Priest", "Shaman", "Mage", "Druid"].map((c) => `${c}: no reviewed guide yet`));
    for (const role of ["tank", "healer", "damage", "dps"]) expect(text().toLowerCase(), role).not.toContain(role);
  });

  test("a role shows only from a published guide written for it, and each class links its hub", async () => {
    stubGuides([
      { slug: "frost-dungeons", classSlug: "mage", roles: "[damage]" },
      { slug: "warrior-tanking", classSlug: "warrior", roles: "[tank, damage]" },
      { slug: "priest-draft", classSlug: "priest", roles: "[healer]", status: "draft" },
    ]);
    await open("#size=5&classes=mage,priest,warrior");
    expect(items("roles")).toEqual(["Warrior: Tank, Damage", "Priest: no reviewed guide yet", "Mage: Damage"]);
    expect(link("Mage")?.getAttribute("href")).toBe("/classes/mage");
    expect(link("Priest")?.getAttribute("href")).toBe("/classes/priest");
  });
});
