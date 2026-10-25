import { describe, expect, test } from "vitest";
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
});
