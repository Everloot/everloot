import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { TABLES, CURRENT_BUILD } from "@/data/game-data/raid";
import nextConfig from "../../next.config.js";
import { latestAddonRelease } from "./addon-release";
import { trailFor } from "./breadcrumbs";
import { CHAT_PROVIDERS } from "./chat/providers";
import { raidTalentFacts } from "./raid-facts";

test("the newest addon zip wins by version number, not by name order", () => {
  const dir = mkdtempSync(join(tmpdir(), "addon-"));
  try {
    for (const name of ["Everloot-0.2.9.zip", "Everloot-0.10.0.zip", "Everloot-0.2.10.zip", "notes.txt", "Everloot-0.3.zip"]) writeFileSync(join(dir, name), "x");
    expect(latestAddonRelease(dir)).toEqual({ version: "0.10.0", downloadPath: "/downloads/Everloot-0.10.0.zip" });
    expect(latestAddonRelease(join(dir, "missing"))).toBeNull();
    // The link is rebuilt from the version numbers, so a name they would not rebuild exactly is never offered.
    writeFileSync(join(dir, "Everloot-0.011.0.zip"), "x");
    expect(latestAddonRelease(dir)).toEqual({ version: "0.10.0", downloadPath: "/downloads/Everloot-0.10.0.zip" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the real downloads folder yields a release", () => {
  expect(latestAddonRelease()?.version).toMatch(/^\d+\.\d+\.\d+$/);
});

test("breadcrumbs go from Home to the page and never through /tools", () => {
  expect(trailFor("/")).toBeNull();
  expect(trailFor("/nowhere")).toBeNull();
  expect(trailFor("/about")).toEqual([{ name: "Home", path: "/" }, { name: "About", path: "/about" }]);
  expect(trailFor("/tools/raid")?.map((c) => c.path)).toEqual(["/", "/tools/raid"]);
  expect(trailFor("/tools/talents/mage")?.map((c) => c.path)).toEqual(["/", "/tools/talents", "/tools/talents/mage"]);
  expect(trailFor("/tools/talents/notaclass")).toBeNull();
  expect(trailFor("/addons/polestar/packs")?.map((c) => c.path)).toEqual(["/", "/addons", "/addons/polestar", "/addons/polestar/packs"]);
  expect(trailFor("/wow-forever/")?.map((c) => c.path)).toEqual(["/", "/wow-forever"]);
  expect(trailFor("/map/kalimdor")?.map((c) => c.path)).toEqual(["/", "/map", "/map/kalimdor"]);
  expect(trailFor("/map/eastern-kingdoms")?.map((c) => c.name)).toEqual(["Home", "World map", "Eastern Kingdoms"]);
  expect(trailFor("/database/coverage")?.map((c) => c.path)).toEqual(["/", "/database", "/database/coverage"]);
  expect(trailFor("/database/download")?.map((c) => c.path)).toEqual(["/", "/database", "/database/download"]);
  expect(trailFor("/docs")).toEqual([{ name: "Home", path: "/" }, { name: "Docs", path: "/docs" }]);
  for (const path of ["/tools/talents", "/tools/raid", "/lore/npcs", "/database/drops", "/map", "/changes"]) {
    expect(trailFor(path)!.some((c) => c.path === "/tools"), path).toBe(false);
  }
});

test("raid talent facts come from the file's tree and treeProof, naming the tree", () => {
  const facts = raidTalentFacts(TABLES[CURRENT_BUILD]);
  const trueshot = facts.talent.find((b) => b.label === "Trueshot Aura");
  expect(trueshot).toEqual({ label: "Trueshot Aura", class: "Hunter", tree: "Marksmanship", proof: "talent spell" });
  expect(facts.talent.every((b) => b.tree !== null && b.proof)).toBe(true);
  expect(facts.talent.some((b) => b.label === "Battle Shout")).toBe(false);
  const table = TABLES[CURRENT_BUILD];
  const counted = table.entries.filter((e) => e.scope !== "self");
  expect(facts.talent.length + facts.unknownTree.length + facts.baseline).toBe(counted.length);
});

test("every response carries the security headers; the CSP enforces only the plugin, base and framing rules", async () => {
  const [rule] = await nextConfig.headers!();
  expect(rule.source).toBe("/:path*");
  const headers = Object.fromEntries(rule.headers.map((h: { key: string; value: string }) => [h.key, h.value]));
  expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  expect(headers["X-Frame-Options"]).toBe("SAMEORIGIN");
  expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["Permissions-Policy"]).toContain("camera=()");
  expect(headers["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
  // AdSense supports only a nonce-based CSP, so no script, connect or frame source is enforced.
  expect(headers["Content-Security-Policy"]).toBe("object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
  const csp = headers["Content-Security-Policy-Report-Only"];
  // The analytics and consent scripts the site can load stay allowed.
  for (const host of ["static.cloudflareinsights.com", "www.googletagmanager.com", "eu.i.posthog.com", "pagead2.googlesyndication.com"]) expect(csp).toContain(host);
  // The talent calculator fetches its asset manifest from the asset host.
  expect(csp).toMatch(/connect-src [^;]*https:\/\/assets\.everloot\.app/);
  // /chat calls the player's own provider from the page: every provider the browser may call is listed, so the
  // report-only policy stays quiet and would not break chat if it were enforced.
  const connect = csp.match(/connect-src ([^;]*)/)![1].split(" ");
  for (const p of CHAT_PROVIDERS) expect(connect).toContain(new URL(p.baseUrl).origin);
});
