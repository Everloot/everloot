import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, test } from "vitest";
import nextConfig from "../../next.config.js";
import { crossesDocumentBoundary, documentPathname, isProtectedPath } from "./document-boundary";

/** A window with the given address and, unless null, a navigation entry for the document. */
function fakeWindow(pathname: string, documentUrl: string | null) {
  const entries = documentUrl === null ? [] : [{ name: documentUrl }];
  return {
    location: { pathname },
    performance: { getEntriesByType: (type: string) => (type === "navigation" ? entries : []) },
  } as unknown as Window;
}

describe("isProtectedPath", () => {
  test("chat, the account page and settings are protected, with anything under them", () => {
    for (const path of ["/chat", "/account", "/settings", "/chat/x", "/account/keys"]) expect(isProtectedPath(path), path).toBe(true);
  });

  test("the served version's prefix shows the same pages, so they are protected there too", () => {
    for (const path of ["/beta/chat", "/beta/account", "/beta/settings"]) expect(isProtectedPath(path), path).toBe(true);
  });

  test("public pages, look-alike names and the other version's notice page are not", () => {
    for (const path of ["/", "/beta", "/database/items/2589", "/chatter", "/accounts", "/settings-help", "/ptr/chat", "/sign-in"]) {
      expect(isProtectedPath(path), path).toBe(false);
    }
  });

  test("Plans on this device is protected, under the served prefix too; the other tools and look-alikes are not", () => {
    for (const path of ["/tools/builds", "/tools/builds/x", "/beta/tools/builds"]) expect(isProtectedPath(path), path).toBe(true);
    for (const path of ["/tools", "/tools/talents", "/tools/talents/mage", "/tools/buildsx", "/tools/build", "/ptr/tools/builds"]) {
      expect(isProtectedPath(path), path).toBe(false);
    }
  });

  test("Alts on this device is protected too, under the served prefix; look-alikes are not", () => {
    for (const path of ["/tools/alts", "/tools/alts/x", "/beta/tools/alts"]) expect(isProtectedPath(path), path).toBe(true);
    for (const path of ["/tools/altsx", "/tools/alt", "/ptr/tools/alts"]) expect(isProtectedPath(path), path).toBe(false);
  });

  test("writing a guide is protected, under the served prefix too; the guide pages and look-alikes are not", () => {
    for (const path of ["/guides/write", "/guides/write/x", "/beta/guides/write"]) expect(isProtectedPath(path), path).toBe(true);
    for (const path of ["/guides", "/guides/frost-leveling", "/guides/feed.xml", "/guides/writer", "/guides/writ", "/ptr/guides/write"]) {
      expect(isProtectedPath(path), path).toBe(false);
    }
  });
});

describe("documentPathname", () => {
  test("reads the address the document was loaded at, not where the app has moved since", () => {
    expect(documentPathname(fakeWindow("/chat", "https://everloot.app/database/items?q=1#top"))).toBe("/database/items");
  });

  test("without a navigation entry, the first address it is asked about stands for the document", () => {
    const fallback = { first: undefined as string | undefined };
    expect(documentPathname(fakeWindow("/chat", null), fallback)).toBe("/chat");
    expect(documentPathname(fakeWindow("/", null), fallback)).toBe("/chat");
  });
});

describe("crossesDocumentBoundary", () => {
  test("moving between public and protected pages crosses it, both ways", () => {
    expect(crossesDocumentBoundary("/chat", fakeWindow("/chat", "https://everloot.app/"))).toBe(true);
    expect(crossesDocumentBoundary("/", fakeWindow("/", "https://everloot.app/account"))).toBe(true);
  });

  test("staying on the same side does not, nor does a reload of the page being shown", () => {
    expect(crossesDocumentBoundary("/settings", fakeWindow("/settings", "https://everloot.app/chat"))).toBe(false);
    expect(crossesDocumentBoundary("/wiki", fakeWindow("/wiki", "https://everloot.app/"))).toBe(false);
    expect(crossesDocumentBoundary("/beta/chat", fakeWindow("/beta/chat", "https://everloot.app/chat"))).toBe(false);
  });

  test("without a navigation entry, a page never asks to reload the document it was loaded in", () => {
    const fallback = { first: undefined as string | undefined };
    expect(crossesDocumentBoundary("/chat", fakeWindow("/chat", null), fallback)).toBe(false);
    // A later move across is still caught, against the document's first address.
    expect(crossesDocumentBoundary("/", fakeWindow("/", null), fallback)).toBe(true);
  });

  test("on the server there is no document to compare, so nothing crosses", () => {
    expect(crossesDocumentBoundary("/chat", undefined)).toBe(false);
  });

  test("going from the calculator to Plans on this device crosses it, and so does opening a plan in the calculator", () => {
    expect(crossesDocumentBoundary("/tools/builds", fakeWindow("/tools/builds", "https://everloot.app/tools/talents/mage"))).toBe(true);
    expect(crossesDocumentBoundary("/tools/talents/mage", fakeWindow("/tools/talents/mage", "https://everloot.app/tools/builds"))).toBe(true);
    expect(crossesDocumentBoundary("/tools/builds", fakeWindow("/tools/builds", "https://everloot.app/settings"))).toBe(false);
  });

  test("going from a public page to Alts on this device crosses it, and so does opening a plan from an alt; the plans page does not", () => {
    expect(crossesDocumentBoundary("/tools/alts", fakeWindow("/tools/alts", "https://everloot.app/tools"))).toBe(true);
    expect(crossesDocumentBoundary("/tools/talents/mage", fakeWindow("/tools/talents/mage", "https://everloot.app/tools/alts"))).toBe(true);
    expect(crossesDocumentBoundary("/tools/alts", fakeWindow("/tools/alts", "https://everloot.app/tools/builds"))).toBe(false);
  });

  test("going from the guides to writing one crosses it, and so does a link from the draft's preview to a guide; settings does not", () => {
    expect(crossesDocumentBoundary("/guides/write", fakeWindow("/guides/write", "https://everloot.app/guides"))).toBe(true);
    expect(crossesDocumentBoundary("/guides/frost-leveling", fakeWindow("/guides/frost-leveling", "https://everloot.app/guides/write?guide=1"))).toBe(true);
    // Settings, where a handle is chosen, is on the same side.
    expect(crossesDocumentBoundary("/guides/write", fakeWindow("/guides/write", "https://everloot.app/settings"))).toBe(false);
  });
});

/** The headers a request for `path` gets: Next applies every matching entry in order, and a later entry's key wins. */
async function headersFor(path: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await nextConfig.headers!()) {
    if (getPathMatch(entry.source)(path) === false) continue;
    for (const { key, value } of entry.headers) out[key] = value;
  }
  return out;
}

describe("Plans on this device's document", () => {
  test("gets the protected pages' policy: scripts from this site only, no frames, and no ad or analytics host to connect to", async () => {
    const strict = (await headersFor("/chat"))["Content-Security-Policy"]!;
    const site = await headersFor("/");
    // Alts on this device holds the same workspace, with the alts' notes, and gets the same policy.
    for (const path of ["/tools/builds", "/beta/tools/builds", "/tools/alts", "/beta/tools/alts"]) {
      const got = await headersFor(path);
      expect(got["Content-Security-Policy"], path).toBe(strict);
      // The microphone stays Chat's alone.
      expect(got["Permissions-Policy"], path).toBe(site["Permissions-Policy"]);
    }
    const directives = Object.fromEntries(strict.split(/;\s*/).map((d) => { const [name, ...values] = d.trim().split(/\s+/); return [name, values]; }));
    expect(directives["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directives["frame-src"]).toEqual(["'none'"]);
    for (const host of ["googletagmanager", "google-analytics", "analytics.google", "posthog", "cloudflareinsights", "metricool", "googlesyndication", "doubleclick", "fundingchoices", "adtrafficquality"]) {
      expect(strict, host).not.toContain(host);
    }
  });

  test("leaves the public pages' policy as it was, the calculator a plan opens in included", async () => {
    const site = (await headersFor("/"))["Content-Security-Policy"];
    for (const path of ["/tools", "/tools/talents", "/tools/talents/mage", "/tools/buildsx"]) {
      expect((await headersFor(path))["Content-Security-Policy"], path).toBe(site);
    }
  });
});

describe("the guide writer's document", () => {
  test("gets the protected pages' policy for a player's private drafts, and the published guides keep the public one", async () => {
    const strict = (await headersFor("/chat"))["Content-Security-Policy"]!;
    const site = await headersFor("/");
    for (const path of ["/guides/write", "/beta/guides/write"]) {
      const got = await headersFor(path);
      expect(got["Content-Security-Policy"], path).toBe(strict);
      // The microphone stays Chat's alone.
      expect(got["Permissions-Policy"], path).toBe(site["Permissions-Policy"]);
    }
    for (const path of ["/guides", "/guides/frost-leveling", "/guides/feed.xml", "/guides/writer"]) {
      expect((await headersFor(path))["Content-Security-Policy"], path).toBe(site["Content-Security-Policy"]);
    }
  });
});
