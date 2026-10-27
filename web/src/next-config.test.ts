import picomatch from "next/dist/compiled/picomatch";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { matchHas } from "next/dist/shared/lib/router/utils/prepare-destination";
import { expect, test } from "vitest";
import nextConfig from "../next.config.js";
import { CHAT_PROVIDERS } from "./lib/chat/providers";
import { isProtectedPath } from "./lib/document-boundary";

test("the internal browse route redirects to its public address, and the rewrite serves that address", async () => {
  expect(await nextConfig.redirects!()).toContainEqual({ source: "/lore/browse/:type(npcs|items|quests|zones|spells)", destination: "/lore/:type", permanent: true });
  expect(await nextConfig.rewrites!()).toContainEqual({ source: "/lore/:type(npcs|items|quests|zones|spells)", destination: "/lore/browse/:type" });
});

test("the old gold-per-hour page answers 301 with the addon page's section about it", async () => {
  const redirects = await nextConfig.redirects!();
  expect(redirects).toContainEqual({ source: "/tools/gold-per-hour", destination: "/addon#gold-per-hour", statusCode: 301 });
  expect(redirects).toContainEqual({ source: "/connect", destination: "/docs", permanent: true });
  expect(redirects).toContainEqual({ source: "/lore/forever-launch-date", destination: "/wow-forever", permanent: true });
  expect(redirects).toHaveLength(6);
});

test("www.everloot.app answers 301 with the same path on the apex, and only that host does", async () => {
  const redirects = await nextConfig.redirects!();
  const www = redirects[0]!;
  expect(www).toEqual({ source: "/:path*", has: [{ type: "host", value: "www.everloot.app" }], destination: "https://everloot.app/:path*", statusCode: 301 });
  // The same matchers Next's router runs on each redirect (it passes the query string on by itself).
  const match = getPathMatch(www.source);
  const to = (path: string) => {
    const params = match(path) as { path?: string[] } | false;
    return params === false ? null : www.destination.replace("/:path*", `/${(params.path ?? []).join("/")}`);
  };
  expect(to("/")).toBe("https://everloot.app/");
  expect(to("/database/items/2589")).toBe("https://everloot.app/database/items/2589");
  const host = (h: string) => matchHas({ headers: { host: h }, cookies: {} } as never, {}, www.has);
  expect(host("www.everloot.app")).toBeTruthy();
  for (const other of ["everloot.app", "everloot-git-branch.vercel.app", "localhost:3000"]) expect(host(other), other).toBe(false);
});

test("the tools' HTTP route is traced with the release files, as the MCP mounts are", () => {
  const includes = nextConfig.outputFileTracingIncludes!;
  // The same matcher Next's build uses on each route key.
  const keyFor = (route: string) => Object.keys(includes).find((key) => picomatch(key, { dot: true, contains: true })(route));
  expect(keyFor("/api/tools/[tool]/route")).toBe("/api/tools");
  expect(includes[keyFor("/api/tools/[tool]/route")!]).toEqual(includes["/mcp/public"]);
  expect(keyFor("/api/items/route")).toBeUndefined();
});

test("every route that reads the wiki pages carries them in its bundle", () => {
  const includes = nextConfig.outputFileTracingIncludes!;
  const keyFor = (route: string) => Object.keys(includes).find((key) => picomatch(key, { dot: true, contains: true })(route));
  // The wiki pages are read from kb/wiki at request time, so a route that lists or shows them needs the
  // folder in its own bundle. Without it the route answers 500 in production while the tests pass.
  for (const route of ["/wiki/route", "/wiki/[slug]/route", "/sitemap.xml/route", "/guides/route", "/guides/[slug]/route"]) {
    const key = keyFor(route);
    expect(key, route).toBeDefined();
    expect(includes[key!], route).toContain("../kb/wiki/*.md");
    expect(includes[key!], route).toContain("../kb/wiki/categories.yaml");
  }
});

test("every route that reads the guides carries them in its bundle", () => {
  const includes = nextConfig.outputFileTracingIncludes!;
  // The guide index reads kb/guides on each request, a guide page when it is rebuilt and the sitemap on each request.
  // The class hubs and the guide cards are drawn while the site builds, so they need no copy.
  const carries = (route: string) => Object.keys(includes).filter((key) => picomatch(key, { dot: true, contains: true })(route)).flatMap((key) => includes[key]);
  for (const route of ["/guides/route", "/guides/[slug]/route", "/guides/feed.xml/route", "/classes/[class]/feed.xml/route", "/sitemap.xml/route"]) expect(carries(route), route).toContain("../kb/guides/*.md");
});

test("the build cache checks the protocol package's files, and trusts every other package's version", () => {
  const config = nextConfig.webpack!({ resolve: {}, snapshot: { immutablePaths: [] } } as never, { isServer: true } as never) as { snapshot: { managedPaths: RegExp[]; immutablePaths: unknown[] } };
  const managed = (file: string) => config.snapshot.managedPaths.some((re) => re.test(file));
  expect(managed("/vercel/path0/web/node_modules/zod/index.js")).toBe(true);
  expect(managed("/vercel/path0/web/node_modules/@everloot/protocol/dist/index.js")).toBe(false);
  expect(managed("C:\\work\\web\\node_modules\\@everloot\\protocol\\dist\\index.js")).toBe(false);
  expect(config.snapshot.immutablePaths).toEqual([]);
});

/** The headers a request for `path` gets: Next applies every matching entry in order, and a later entry's key wins. */
test("the public pages rendered on every request are kept at the CDN; the changes and search pages briefly; signed-in pages never", async () => {
  // Found live 10/27: /database, /map and /changes answered private, no-store, so every visit ran the server.
  const hour = "max-age=3600, stale-while-revalidate=86400";
  const brief = "max-age=300, stale-while-revalidate=3600";
  for (const [path, value] of [["/database", hour], ["/map", hour], ["/map/kalimdor", hour], ["/changes", brief], ["/search", brief]] as const) {
    const got = await headersFor(path);
    expect(got["Vercel-CDN-Cache-Control"], path).toBe(value);
    expect(got["CDN-Cache-Control"], path).toBe(value);
  }
  for (const path of ["/chat", "/account", "/settings", "/sign-in", "/api/tools/search_knowledge", "/changes/feed.xml"]) {
    expect(await headersFor(path), path).not.toHaveProperty("Vercel-CDN-Cache-Control");
  }
});

async function headersFor(path: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await nextConfig.headers!()) {
    if (getPathMatch(entry.source)(path) === false) continue;
    for (const { key, value } of entry.headers) out[key] = value;
  }
  return out;
}

const directives = (csp: string) => Object.fromEntries(csp.split(/;\s*/).map((d) => { const [name, ...values] = d.trim().split(/\s+/); return [name, values]; }));

const PROTECTED = ["/chat", "/account", "/settings", "/chat/anything", "/beta/chat", "/beta/account", "/beta/settings"];
const PUBLIC = ["/", "/database/items/2589", "/chatter", "/accounts", "/settings-help", "/beta", "/beta/wiki", "/ptr/chat", "/sign-in"];

test("the pages that hold chat keys and the account enforce the strict policy; every other page keeps the public one", async () => {
  const site = await headersFor("/");
  expect(site["Content-Security-Policy"]).toBe("object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
  for (const path of PROTECTED) {
    expect(isProtectedPath(path), path).toBe(true);
    const got = await headersFor(path);
    expect(directives(got["Content-Security-Policy"]!)["script-src"], path).toEqual(["'self'", "'unsafe-inline'"]);
    // Every other header the site sends stays as it is (Chat's microphone rule is checked below).
    expect({ ...got, "Content-Security-Policy": "", "Permissions-Policy": "" }, path).toEqual({ ...site, "Content-Security-Policy": "", "Permissions-Policy": "" });
  }
  for (const path of PUBLIC) {
    expect(isProtectedPath(path), path).toBe(false);
    expect((await headersFor(path))["Content-Security-Policy"], path).toBe(site["Content-Security-Policy"]);
  }
});

test("the strict policy loads scripts from this site only, and connects only to it, its assets and the chat providers", async () => {
  const csp = directives((await headersFor("/chat"))["Content-Security-Policy"]!);
  expect(csp["default-src"]).toEqual(["'self'"]);
  expect(csp["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
  const providers = CHAT_PROVIDERS.map((p) => new URL(p.baseUrl).origin);
  expect(providers).toContain("http://localhost:11434");
  expect([...csp["connect-src"]!].sort()).toEqual([...new Set(["'self'", "https://assets.everloot.app", ...providers])].sort());
  expect(csp["img-src"]).toEqual(["'self'", "data:", "blob:", "https://assets.everloot.app"]);
  expect(csp["frame-src"]).toEqual(["'none'"]);
  expect(csp["object-src"]).toEqual(["'none'"]);
  expect(csp["base-uri"]).toEqual(["'self'"]);
  expect(csp["frame-ancestors"]).toEqual(["'self'"]);
});

/** The features a Permissions-Policy header grants, by name. */
const features = (policy: string) => Object.fromEntries(policy.split(/,\s*/).map((f) => f.trim().split("=") as [string, string]));

test("Chat may ask for the microphone (dictation); every other page, the account and settings included, may not", async () => {
  const site = features((await headersFor("/"))["Permissions-Policy"]!);
  expect(site["microphone"]).toBe("()");
  for (const path of ["/chat", "/chat/anything", "/beta/chat", "/beta/chat/anything"]) {
    const got = await headersFor(path);
    expect(features(got["Permissions-Policy"]!), path).toEqual({ ...site, microphone: "(self)" });
    // One header, not a second spelling of it.
    expect(Object.keys(got).filter((k) => k.toLowerCase() === "permissions-policy"), path).toEqual(["Permissions-Policy"]);
    // The strict policy those pages get is unchanged.
    expect(got["Content-Security-Policy"], path).toBe((await headersFor("/account"))["Content-Security-Policy"]);
  }
  for (const path of ["/", "/account", "/settings", "/beta/account", "/beta/settings", "/ptr/chat", "/chatter", "/beta", "/beta/wiki", "/database/items/2589", "/sign-in"]) {
    expect(features((await headersFor(path))["Permissions-Policy"]!), path).toEqual(site);
  }
});

test("only the root sitemap gets static CDN caching; fallible sitemaps and private routes set their own policy", async () => {
  const got = await headersFor("/sitemap.xml");
  expect(got["Vercel-CDN-Cache-Control"]).toBe("max-age=3600, stale-while-revalidate=86400");
  expect(got["CDN-Cache-Control"]).toBe("max-age=3600, stale-while-revalidate=86400");
  for (const path of ["/", "/database-sitemap.xml", "/database-sitemap/3.xml", "/auctions-sitemap.xml", "/auctions-sitemap/0.xml", ...PROTECTED, "/sign-in", "/api/auth/session", "/api/me"]) {
    const h = await headersFor(path);
    expect(h["Vercel-CDN-Cache-Control"], path).toBeUndefined();
    expect(h["CDN-Cache-Control"], path).toBeUndefined();
  }
});
