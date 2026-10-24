// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Header from "./Header";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/" }));

let container: HTMLDivElement;
let root: Root;
const user = { id: "test-user", bnet_id: "1", battletag: "Tester#1", entitlements: [] };
function signInLink() {
  return Array.from(container.querySelectorAll("a")).find(a => /sign in/i.test(a.textContent ?? ""));
}
function button(label: string) {
  const result = Array.from(container.querySelectorAll("button")).find(b => b.textContent === label);
  expect(result).toBeDefined();
  return result!;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  refresh.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("header account controls", () => {
  it("keeps a compact close control with an accessible menu name and Escape focus restoration", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ user }));
    await act(async () => root.render(<Header />));
    const toggle = button("Menu");
    await act(async () => toggle.click());
    expect(toggle.textContent).toBe("Close");
    expect(toggle.getAttribute("aria-label")).toBe("Close menu");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await act(async () => toggle.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("lets an anonymous visitor start Battle.net sign-in from the header", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ user: null }));
    await act(async () => root.render(<Header />));
    expect(signInLink()?.getAttribute("href")).toBe("/sign-in");
  });

  it("keeps the addon download reachable in the mobile menu", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ user: null }));
    await act(async () => root.render(<Header />));
    await act(async () => button("Menu").click());
    expect(container.querySelector('#site-navigation a[href="/addon"]')?.textContent).toBe("Get the addon");
  });

  // The text links moved into the avatar menu, and My builds is now Your builds there (account shell spec).
  it("links a signed-in visitor to Your builds only with saved builds on", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ user }));
    await act(async () => root.render(<Header />));
    expect(container.querySelector('a[href="/me"]')).toBeNull();
    await act(async () => root.render(<Header savedBuilds />));
    expect(container.querySelector('#account-menu a[href="/me"]')?.textContent).toBe("Your builds");
  });

  it("signs an authenticated visitor out with POST and returns to sign-in", async () => {
    let logoutMethod: string | undefined;
    vi.stubGlobal("fetch", async (url: string, options?: RequestInit) => {
      if (url === "/api/auth/me") return Response.json({ user });
      if (url === "/api/auth/logout") { logoutMethod = options?.method; return Response.json({ ok: true }); }
      throw new Error("Unexpected request");
    });
    await act(async () => root.render(<Header />));
    expect(signInLink()).toBeUndefined();
    await act(async () => button("Sign out").click());
    expect(logoutMethod).toBe("POST");
    expect(signInLink()?.getAttribute("href")).toBe("/sign-in");
  });

  it("reports an unavailable account lookup and lets the visitor retry", async () => {
    let lookup = 0;
    vi.stubGlobal("fetch", async () => ++lookup === 1
      ? Response.json({ error: "Authentication is temporarily unavailable" }, { status: 503 })
      : Response.json({ user: null }));
    await act(async () => root.render(<Header />));
    expect(signInLink()).toBeUndefined();
    expect(container.querySelector('[role="alert"]')?.textContent ?? "").toMatch(/account.*unavailable/i);
    await act(async () => button("Retry").click());
    expect(signInLink()?.getAttribute("href")).toBe("/sign-in");
  });

  it("keeps sign-out available after a failed logout and supports a successful retry", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "/api/auth/me") return Response.json({ user });
      if (url === "/api/auth/logout") return ++attempts === 1
        ? Response.json({ error: "Logout is temporarily unavailable" }, { status: 503 })
        : Response.json({ ok: true });
      throw new Error("Unexpected request");
    });
    await act(async () => root.render(<Header />));
    await act(async () => button("Sign out").click());
    expect(signInLink()).toBeUndefined();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/sign out.*failed/i);
    await act(async () => button("Sign out").click());
    expect(signInLink()).toBeDefined();
  });

  it("announces pending logout and prevents duplicate submissions", async () => {
    let finish!: (response: Response) => void;
    let attempts = 0;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "/api/auth/me") return Response.json({ user });
      // The avatar menu also asks for the player's shell; only logout attempts count here.
      if (url === "/api/me/shell") return Response.json({ error: "Not found" }, { status: 404 });
      attempts++;
      return pending;
    });
    await act(async () => root.render(<Header />));
    await act(async () => button("Sign out").click());
    const pendingButton = Array.from(container.querySelectorAll("button")).find(b => /sign.*out/i.test(b.textContent ?? ""))!;
    expect(pendingButton.disabled).toBe(true);
    expect(pendingButton.getAttribute("aria-busy")).toBe("true");
    await act(async () => pendingButton.click());
    expect(attempts).toBe(1);
    await act(async () => finish(Response.json({ ok: true })));
    expect(signInLink()).toBeDefined();
  });
});
