import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, test } from "vitest";
import { withoutVersionPrefix as kbWithoutVersionPrefix } from "../../../kb/src/wiki/page";
import nextConfig from "../../next.config.js";
import { PREFIXES, SERVED, WITHOUT_SNAPSHOT, hasSnapshot, versionHref, withoutVersionPrefix } from "./build-versions";
import { CURRENT_VERSION, GAME_VERSIONS } from "./game-version";

const byId = (id: string) => GAME_VERSIONS.find((v) => v.id === id)!;

/**
 * Where Next's router sends a path that is not a static file: the first rewrite that matches, with its parameters
 * filled in. Next stops at the route the rewrite lands on, dynamic ones included, so one rewrite is all a path gets.
 */
async function served(path: string): Promise<string> {
  const rewrites = (await nextConfig.rewrites!()) as { source: string; destination: string }[];
  for (const r of rewrites) {
    const params = getPathMatch(r.source)(path) as Record<string, string | string[]> | false;
    if (params !== false) return r.destination.replace(/:(\w+)\+?/g, (_, name: string) => [params[name]].flat().join("/"));
  }
  return path;
}

describe("game version routing", () => {
  test("the served version is the one the header names, and the only one with the snapshot", () => {
    expect(SERVED.id).toBe(CURRENT_VERSION.id);
    expect(GAME_VERSIONS.filter(hasSnapshot).map((v) => v.id)).toEqual([SERVED.id]);
  });

  test("Live has no prefix: its pages are the unprefixed ones, so the live URLs never change", () => {
    expect(PREFIXES).toEqual({ ptr: "/ptr", beta: "/beta" });
    for (const id of Object.keys(PREFIXES)) expect(GAME_VERSIONS.map((v) => v.id)).toContain(id);
    expect(versionHref(byId("live"), "/database/items/2589")).toBe("/database/items/2589");
  });

  test("the served version keeps the unprefixed URL; another version's address carries its prefix", () => {
    expect(versionHref(SERVED, "/database/items/2589")).toBe("/database/items/2589");
    expect(versionHref(SERVED)).toBe("/");
    expect(versionHref(byId("ptr"))).toBe("/ptr");
    expect(versionHref(byId("ptr"), "/database/items/2589")).toBe("/ptr/database/items/2589");
  });

  // Every prefixed version but the served one; read from the table, so the switch at launch changes no test here.
  test("a version without the snapshot answers with its notice, never another version's pages", async () => {
    expect(WITHOUT_SNAPSHOT.map((v) => v.id)).toEqual(Object.keys(PREFIXES).filter((id) => id !== SERVED.id));
    expect(WITHOUT_SNAPSHOT.map((v) => v.id)).toContain("ptr");
    for (const v of WITHOUT_SNAPSHOT) {
      expect(await served(PREFIXES[v.id]!)).toBe(`/game-version/${v.id}`);
      expect(await served(`${PREFIXES[v.id]}/database/items/2589`)).toBe(`/game-version/${v.id}`);
    }
  });

  test("the served version's prefix, while it has one, shows the same pages", async () => {
    const prefix = PREFIXES[SERVED.id];
    if (prefix) {
      expect(await served(prefix)).toBe("/");
      expect(await served(`${prefix}/database/items/2589`)).toBe("/database/items/2589");
      expect(await served(`${prefix}/lore/npcs`)).toBe("/lore/browse/npcs");
    }
    // Unprefixed addresses are untouched, including ones that only start with a prefix's letters.
    expect(await served("/database/items/2589")).toBe("/database/items/2589");
    expect(await served("/betamax")).toBe("/betamax");
  });

  test("a path without its version's prefix is the page the unprefixed address shows, for every prefix the table lists", () => {
    expect(withoutVersionPrefix("/beta/guides/fire-draft")).toBe("/guides/fire-draft");
    expect(withoutVersionPrefix("/beta")).toBe("/");
    expect(withoutVersionPrefix("/ptr/guides/fire-draft")).toBe("/guides/fire-draft");
    for (const prefix of Object.values(PREFIXES)) expect(withoutVersionPrefix(`${prefix}/wiki/deadmines`), prefix).toBe("/wiki/deadmines");
    // Paths without a prefix, and ones that only start with a prefix's letters, are left as they are.
    expect(withoutVersionPrefix("/guides/fire-draft")).toBe("/guides/fire-draft");
    expect(withoutVersionPrefix("/betamax/guides/x")).toBe("/betamax/guides/x");
  });

  test("the kb's copy, which its page checks and the wiki's link reading use, takes off the same prefixes", () => {
    for (const path of ["/beta/wiki/x", "/ptr/guides/x", "/beta", "/ptr", "/wiki/x", "/betamax/wiki/x", "/ptrx", "/"]) {
      expect(kbWithoutVersionPrefix(path), path).toBe(withoutVersionPrefix(path));
    }
  });

  test("the notice's internal address redirects to its prefix", async () => {
    const redirect = (await nextConfig.redirects!()).find((r) => r.source.startsWith("/game-version/"))!;
    expect(redirect).toEqual({ source: "/game-version/:id(ptr|beta)", destination: "/:id", permanent: true });
    expect(getPathMatch(redirect.source)("/game-version/ptr")).toEqual({ id: "ptr" });
    expect(getPathMatch(redirect.source)("/game-version/live")).toBe(false);
  });
});
