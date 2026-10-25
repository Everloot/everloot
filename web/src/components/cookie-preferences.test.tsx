import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
import { CookiePreferencesButton } from "./CookieConsent";

test("key pages link to the public preference controls instead of offering an inactive button", () => {
  for (const pathname of ["/chat", "/account", "/beta/settings"]) {
    route.pathname = pathname;
    expect(renderToStaticMarkup(<CookiePreferencesButton />)).toContain('href="/privacy#choices"');
  }
  route.pathname = "/database/items/41";
  expect(renderToStaticMarkup(<CookiePreferencesButton />)).toContain("<button");
});
