import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { GUIDE_ROLES } from "../../../kb/src/guides/guide";
import { CLASSES } from "@/design/tokens";
import {
  CLASS_CONTEXT_SLOT, MAX_LEVEL, ROLES, classHubHref, contextLabel, contextLinks, forgetClassContext, hasClassContext, parseClassContext,
  readClassContext, rememberClassContext, withClassContext, withoutClassContext, type ClassContext,
} from "./class-context";
import { TALENT_CLASSES, loadCatalog } from "./talents/catalogs";

const params = (query: string) => new URLSearchParams(query);
const ok = (context: ClassContext | null) => ({ ok: true, context });

describe("parseClassContext", () => {
  test("a hub link's context reads back: the class from the page, a level from 1 to 60 and a guide role", () => {
    expect(parseClassContext(params("level=25&role=damage"), "mage")).toEqual(ok({ classSlug: "mage", level: 25, role: "damage" }));
    expect(parseClassContext(params(""), "mage")).toEqual(ok({ classSlug: "mage" }));
    expect(parseClassContext(params("level=1"), "druid")).toEqual(ok({ classSlug: "druid", level: 1 }));
    expect(parseClassContext(params("level=60"), "druid")).toEqual(ok({ classSlug: "druid", level: 60 }));
    expect(parseClassContext(params("role=healer"), "priest")).toEqual(ok({ classSlug: "priest", role: "healer" }));
    // A page's own parameters, and a class= the hub's address already settles, are not part of its context.
    expect(parseClassContext(params("class=warrior&sort=name"), "mage")).toEqual(ok({ classSlug: "mage" }));
    // A GET form sends an empty field as an empty value: that is no value, not a bad one.
    expect(parseClassContext(params("level=&role="), "mage")).toEqual(ok({ classSlug: "mage" }));
    // Next hands a server page its query as a record; it reads the same.
    expect(parseClassContext({ class: "warlock", level: "30", role: "damage" })).toEqual(ok({ classSlug: "warlock", level: 30, role: "damage" }));
  });

  test("a class context names one of the nine classes; a link with no class carries none", () => {
    expect(parseClassContext(params(""))).toEqual(ok(null));
    expect(parseClassContext(params("sort=name"))).toEqual(ok(null));
    for (const slug of TALENT_CLASSES) expect(parseClassContext(params(`class=${slug}`)), slug).toEqual(ok({ classSlug: slug }));
    for (const bad of ["Mage", "deathknight", "mage ", "all"]) {
      const read = parseClassContext(params(`class=${encodeURIComponent(bad)}`));
      expect(read.ok, bad).toBe(false);
      expect(!read.ok && read.error, bad).toContain(JSON.stringify(bad));
    }
    expect(parseClassContext(params("level=20"))).toEqual({ ok: false, error: "A level or a role needs a class." });
    expect(parseClassContext(params("role=tank"))).toEqual({ ok: false, error: "A level or a role needs a class." });
  });

  test("a level the game does not have, or one written any other way, is refused with its reason", () => {
    for (const level of ["0", "61", "99", "100", "-1", "2.5", "025", " 25", "1e1", "abc"]) {
      const read = parseClassContext(params(`level=${encodeURIComponent(level)}`), "mage");
      expect(read, level).toEqual({ ok: false, error: `${JSON.stringify(level)} is not a level from 1 to 60.` });
    }
  });

  test("a role is one guides are written for, never one read off a talent tree's name", () => {
    for (const role of ["dps", "Damage", "frost", "arcane", "heals", "unknown"]) {
      const read = parseClassContext(params(`role=${role}`), "mage");
      expect(read, role).toEqual({ ok: false, error: `${JSON.stringify(role)} is not a role guides are written for: tank, healer or damage.` });
    }
  });

  test("a value given twice is refused rather than one of the two picked", () => {
    expect(parseClassContext(params("level=20&level=30"), "mage")).toEqual({ ok: false, error: "The link gives level more than once." });
    expect(parseClassContext(params("role=tank&role=healer"), "warrior")).toEqual({ ok: false, error: "The link gives role more than once." });
    expect(parseClassContext({ class: ["mage", "druid"] })).toEqual({ ok: false, error: "The link gives class more than once." });
  });

  test("a long bad value is shortened where the reason repeats it", () => {
    const read = parseClassContext(params(`role=${"x".repeat(500)}`), "mage");
    expect(read.ok).toBe(false);
    expect(!read.ok && read.error.length).toBeLessThan(120);
  });
});

test("the classes, the top level and the roles are the ones the calculators and the guide schema use", async () => {
  expect([...CLASSES]).toEqual(TALENT_CLASSES);
  for (const slug of TALENT_CLASSES) expect((await loadCatalog(slug)).rules.maxLevel, slug).toBe(MAX_LEVEL);
  expect([...ROLES]).toEqual([...GUIDE_ROLES]);
});

/** The page file a site path is served by: the exact folder, or a dynamic [segment] folder for its last part. */
const APP = fileURLToPath(new URL("../app", import.meta.url));
function routeFile(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  const parent = join(APP, ...parts.slice(0, -1));
  const dynamic = existsSync(parent) ? readdirSync(parent).filter((d) => /^\[[a-z]+\]$/.test(d)).map((d) => join(parent, d, "page.tsx")) : [];
  return [join(APP, ...parts, "page.tsx"), ...dynamic].find((f) => existsSync(f)) ?? null;
}

describe("contextLinks", () => {
  const full: ClassContext = { classSlug: "mage", level: 25, role: "damage" };

  test("every link opens a page the site has, the hub, the calculator, spells, items, raid, professions and dungeons", () => {
    const links = contextLinks(full);
    expect(links.map((l) => l.key)).toEqual(["hub", "talents", "spells", "items", "raid", "professions", "dungeons"]);
    for (const link of links) expect(routeFile(new URL(link.href, "https://everloot.app").pathname), link.href).not.toBeNull();
    for (const link of links) expect(link.label.trim(), link.key).not.toBe("");
  });

  test("each link carries only the context its page reads: the hub, spells, items, raid and professions all of it, the calculator its class, dungeons none yet", () => {
    expect(Object.fromEntries(contextLinks(full).map((l) => [l.key, l.href]))).toEqual({
      hub: "/classes/mage?level=25&role=damage",
      talents: "/tools/talents/mage",
      spells: "/database/spells?class=mage&level=25&role=damage",
      items: "/database/items?class=mage&level=25&role=damage",
      raid: "/tools/raid?class=mage&level=25&role=damage",
      professions: "/tools/professions?class=mage&level=25&role=damage",
      dungeons: "/database/instances",
    });
    expect(contextLinks({ classSlug: "druid" }).find((l) => l.key === "items")?.href).toBe("/database/items?class=druid");
    expect(classHubHref({ classSlug: "druid" })).toBe("/classes/druid");
    expect(classHubHref({ classSlug: "druid", role: "healer" })).toBe("/classes/druid?role=healer");
  });

  test("a link reads back as the context it was made from, on the hub and on every page it leads to", () => {
    const contexts: ClassContext[] = [{ classSlug: "mage" }, full, { classSlug: "warrior", role: "tank" }, { classSlug: "hunter", level: 60 }];
    for (const context of contexts) {
      const url = new URL(classHubHref(context), "https://everloot.app");
      expect(parseClassContext(url.searchParams, url.pathname.split("/").pop()), url.href).toEqual(ok(context));
      for (const link of contextLinks(context).filter((l) => ["spells", "items", "raid", "professions"].includes(l.key))) {
        expect(parseClassContext(new URL(link.href, "https://everloot.app").searchParams), link.href).toEqual(ok(context));
      }
    }
  });

  test("a context is named in words, in the order the link carries it", () => {
    expect(contextLabel({ classSlug: "mage" })).toBe("Mage");
    expect(contextLabel({ classSlug: "mage", level: 25 })).toBe("Mage, level 25");
    expect(contextLabel({ classSlug: "warrior", role: "tank" })).toBe("Warrior, tank");
    expect(contextLabel(full)).toBe("Mage, level 25, damage");
  });
});

describe("a context on the links of the pages it leads to", () => {
  const full: ClassContext = { classSlug: "mage", level: 25, role: "damage" };

  test("a page's own link keeps its parameters as they are and adds the context after them", () => {
    expect(withClassContext("/database/items/armor/cloth?quality=rare,epic&sort=-id", full)).toBe("/database/items/armor/cloth?quality=rare,epic&sort=-id&class=mage&level=25&role=damage");
    expect(withClassContext("/database/spells", { classSlug: "druid" })).toBe("/database/spells?class=druid");
    expect(withClassContext("/database/spells?q=bolt", null)).toBe("/database/spells?q=bolt");
  });

  test("taking the context off an address keeps every other parameter as it was given", () => {
    expect(withoutClassContext("/database/items/armor/cloth", { quality: "rare,epic", class: "mage", sort: "-id", level: "25", role: "damage" }))
      .toBe("/database/items/armor/cloth?quality=rare,epic&sort=-id");
    expect(withoutClassContext("/tools/raid", params("class=mage&level=25"))).toBe("/tools/raid");
    // A context the page refused goes too, so the address holds nothing the page left out.
    expect(withoutClassContext("/database/spells", params("q=frost&class=deathknight&level=99"))).toBe("/database/spells?q=frost");
    expect(withoutClassContext("/tools/professions", { profession: ["Tailoring", "Alchemy"], class: "mage" })).toBe("/tools/professions?profession=Tailoring&profession=Alchemy");
  });

  test("an address carries a context when it gives a class, a level or a role, even one the page cannot read", () => {
    for (const none of [{}, { q: "bolt", sort: "name" }, { class: "", level: "" }]) expect(hasClassContext(none), JSON.stringify(none)).toBe(false);
    for (const some of [{ class: "mage" }, { level: "99" }, { class: "deathknight" }, { role: "tank" }]) expect(hasClassContext(some), JSON.stringify(some)).toBe(true);
    expect(hasClassContext(params("class=mage&level=25"))).toBe(true);
  });
});

/** A browser's storage held in a map; `refuse` makes one of its calls throw, as a full or blocked store does. */
function memory(seed?: string, refuse?: "getItem" | "setItem" | "removeItem") {
  const items = new Map<string, string>(seed === undefined ? [] : [[CLASS_CONTEXT_SLOT, seed]]);
  const fail = (call: string) => { if (refuse === call) throw new Error(`${call} refused`); };
  return {
    items,
    getItem: (k: string) => { fail("getItem"); return items.get(k) ?? null; },
    setItem: (k: string, v: string) => { fail("setItem"); items.set(k, v); },
    removeItem: (k: string) => { fail("removeItem"); items.delete(k); },
  };
}

describe("the class this browser remembers", () => {
  test("is read back only when it is a context the site can read; anything else is no remembered class", () => {
    expect(readClassContext(memory(JSON.stringify({ classSlug: "mage", level: 25, role: "damage" })))).toEqual({ classSlug: "mage", level: 25, role: "damage" });
    expect(readClassContext(memory(JSON.stringify({ classSlug: "druid" })))).toEqual({ classSlug: "druid" });
    for (const stale of [
      "not json", "null", "[]", '"mage"',
      JSON.stringify({ classSlug: "deathknight" }),
      JSON.stringify({ classSlug: "mage", level: 99 }),
      JSON.stringify({ classSlug: "mage", level: "25" }),
      JSON.stringify({ classSlug: "mage", level: 2.5 }),
      JSON.stringify({ classSlug: "mage", role: "dps" }),
      JSON.stringify({ classSlug: "mage", spec: "frost" }),
    ]) expect(readClassContext(memory(stale)), stale).toBeNull();
    expect(readClassContext(memory())).toBeNull();
    expect(readClassContext(memory(JSON.stringify({ classSlug: "mage" }), "getItem"))).toBeNull();
    expect(readClassContext(null)).toBeNull();
  });

  test("is kept as the context given, and reported kept only when the browser kept it", () => {
    const store = memory();
    expect(rememberClassContext(store, { classSlug: "mage", level: 25, role: "damage" })).toBe(true);
    expect(JSON.parse(store.items.get(CLASS_CONTEXT_SLOT)!)).toEqual({ classSlug: "mage", level: 25, role: "damage" });
    expect(rememberClassContext(memory(undefined, "setItem"), { classSlug: "mage" })).toBe(false);
    // A store that takes the write and keeps nothing (a private window's, at its quota) is a failure too.
    const forgetful = { ...memory(), setItem: () => {} };
    expect(rememberClassContext(forgetful, { classSlug: "mage" })).toBe(false);
    expect(rememberClassContext(null, { classSlug: "mage" })).toBe(false);
  });

  test("is forgotten on request, and a store that refuses says so", () => {
    const store = memory(JSON.stringify({ classSlug: "mage" }));
    expect(forgetClassContext(store)).toBe(true);
    expect(store.items.has(CLASS_CONTEXT_SLOT)).toBe(false);
    expect(forgetClassContext(memory(JSON.stringify({ classSlug: "mage" }), "removeItem"))).toBe(false);
    expect(forgetClassContext(null)).toBe(false);
  });
});
