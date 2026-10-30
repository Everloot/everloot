import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
import { CookiePreferencesButton } from "./CookieConsent";
import { PREFIXES, SERVED } from "@/lib/build-versions";

test("key pages link to the public preference controls instead of offering an inactive button", () => {
  // Under the served version's prefix too, while it has one (/beta before launch).
  for (const pathname of ["/chat", "/account", `${PREFIXES[SERVED.id] ?? ""}/settings`]) {
    route.pathname = pathname;
    expect(renderToStaticMarkup(<CookiePreferencesButton />)).toContain('href="/privacy#choices"');
  }
  route.pathname = "/database/items/41";
  expect(renderToStaticMarkup(<CookiePreferencesButton />)).toContain("<button");
});
