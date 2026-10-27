import { NextRequest } from "next/server";
import { afterEach, expect, test, vi } from "vitest";
import { config, middleware } from "./middleware";

const request = (cookie?: string) => new NextRequest("https://everloot.app/", { headers: cookie ? { cookie } : {} });
const rewrittenTo = (res: Response) => res.headers.get("x-middleware-rewrite");

afterEach(() => { vi.unstubAllEnvs(); });

test("only / goes through the middleware", () => {
  expect(config.matcher).toBe("/");
});

test("with a session cookie, / is the signed-in home, marked as the rewrite", () => {
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  for (const cookie of [`everloot_session=${"a".repeat(64)}`, "everloot.session_token=abc.def", "__Secure-everloot.session_token=abc.def"]) {
    const res = middleware(request(`theme=dark; ${cookie}`));
    expect(rewrittenTo(res)).toBe("https://everloot.app/home");
    expect(res.headers.get("x-middleware-request-x-everloot-home")).toBe("1");
  }
});

test("the query goes along with the rewrite", () => {
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  const res = middleware(new NextRequest("https://everloot.app/?added=bnet", { headers: { cookie: "everloot.session_token=abc.def" } }));
  expect(rewrittenTo(res)).toBe("https://everloot.app/home?added=bnet");
});

test("with Better Auth on, only its cookie counts: a leftover legacy cookie is not a session", () => {
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  vi.stubEnv("EVERLOOT_AUTH_V2", "1");
  expect(rewrittenTo(middleware(request(`everloot_session=${"a".repeat(64)}`)))).toBeNull();
  expect(rewrittenTo(middleware(request("__Secure-everloot.session_token=abc.def")))).toBe("https://everloot.app/home");
});

test("without one, or with only other cookies, / stays the landing page", () => {
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  expect(rewrittenTo(middleware(request()))).toBeNull();
  expect(rewrittenTo(middleware(request("everloot_return_to=/me; everloot.session_data=x; everloot_session=")))).toBeNull();
});

test("with the switch off nothing is rewritten", () => {
  for (const value of ["", "0", "true"]) {
    vi.stubEnv("EVERLOOT_PROFILES", value);
    expect(rewrittenTo(middleware(request("everloot.session_token=abc.def")))).toBeNull();
  }
});

test("every PROFILES and SAVED_BUILDS combination: only PROFILES decides, for a legacy session as for Better Auth's", () => {
  vi.stubEnv("EVERLOOT_AUTH_V2", "");
  for (const profiles of ["", "0", "1"]) {
    for (const savedBuilds of ["", "0", "1"]) {
      vi.stubEnv("EVERLOOT_PROFILES", profiles);
      vi.stubEnv("EVERLOOT_SAVED_BUILDS", savedBuilds);
      for (const cookie of [`everloot_session=${"a".repeat(64)}`, "everloot.session_token=abc.def"]) {
        expect(rewrittenTo(middleware(request(cookie))), `${profiles}/${savedBuilds}`).toBe(profiles === "1" ? "https://everloot.app/home" : null);
      }
      expect(rewrittenTo(middleware(request()))).toBeNull();
    }
  }
});

test("the rewrite caches nothing itself: a signed-in / carries no cache or cookie headers from here", () => {
  // /home renders per request (force-dynamic, noindex), so the per-user page is never stored for the next visitor.
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  const signedIn = middleware(request(`everloot_session=${"a".repeat(64)}`));
  const visitor = middleware(request());
  expect(rewrittenTo(signedIn)).toBe("https://everloot.app/home");
  expect(rewrittenTo(visitor)).toBeNull();
  for (const res of [signedIn, visitor]) {
    for (const name of ["cache-control", "cdn-cache-control", "vercel-cdn-cache-control", "expires", "set-cookie", "vary"]) {
      expect(res.headers.get(name), name).toBeNull();
    }
  }
});
