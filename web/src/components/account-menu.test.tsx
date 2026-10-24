// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountShell, DeviceAccount } from "@/lib/account-shell-types";
import { SHELL_CHANGED_EVENT } from "@/lib/profiles";
import AccountControls from "./AccountControls";
import Header from "./Header";
import { accountMenuSections, currentStatus, initials } from "./AccountMenu";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/" }));

const ME = "11111111-2222-4333-8444-555555555555";
const ALT = "22222222-3333-4444-8555-666666666666";
const MAGE = "33333333-4444-4555-8666-777777777777";

const shell = (over: Partial<AccountShell> = {}): AccountShell => ({
  userId: ME,
  name: "Jaina#1234",
  handle: "jaina",
  displayName: "Jaina Proudmoore",
  status: { emoji: "🔥", text: "Raiding Molten Core", clearsAt: null },
  publicProfile: false,
  characters: [{ id: MAGE, name: "Jaina", classSlug: "mage", realm: null }],
  mainCharacterId: MAGE,
  activeCharacterId: MAGE,
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const reload = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  refresh.mockReset();
  reload.mockReset();
  // jsdom cannot reload; stand in for it.
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, reload } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  vi.unstubAllGlobals();
});

const avatarButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="Account menu"]')!;
const accountMenu = () => container.querySelector<HTMLElement>("#account-menu")!;
const menuLinks = () => Array.from(accountMenu().querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]);
const buttons = (scope: ParentNode, label: string) => Array.from(scope.querySelectorAll("button")).filter((b) => b.textContent === label);

type Route = (init?: RequestInit) => Response | Promise<Response>;
const signedIn: Route = () => Response.json({ user: { id: ME, name: "Thrall#1", entitlements: [] } });
/** A mocked fetch: signed in, /api/me/shell 404 (EVERLOOT_PROFILES off) unless a route says otherwise. */
function api(routes: Record<string, Route> = {}) {
  const all: Record<string, Route> = { "/api/auth/me": signedIn, "/api/me/shell": () => Response.json({ error: "Not found" }, { status: 404 }), ...routes };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const route = all[url];
    if (!route) throw new Error(`Unexpected request ${url}`);
    return route(init);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const withShell = (s: AccountShell, routes: Record<string, Route> = {}) => api({ "/api/me/shell": () => Response.json(s), ...routes });

describe("signed in without a shell (EVERLOOT_PROFILES off)", () => {
  let fetch: ReturnType<typeof api>;
  beforeEach(() => { fetch = api(); });
  afterEach(() => {
    // With the switch off the menu never asks for the shell: no 404 per page, no listener.
    expect(fetch.mock.calls.filter(([url]) => url === "/api/me/shell")).toHaveLength(0);
  });

  it("does not listen for shell changes", async () => {
    await act(async () => root.render(<Header savedBuilds />));
    await act(async () => { window.dispatchEvent(new Event(SHELL_CHANGED_EVENT)); });
  });

  it("shows the + menu and the avatar instead of Sign in and Get the addon", async () => {
    await act(async () => root.render(<Header savedBuilds />));
    expect(container.querySelector('a[href="/sign-in"]')).toBeNull();
    expect(Array.from(container.querySelectorAll("a")).some((a) => a.textContent === "Get the addon")).toBe(false);
    expect(avatarButton().textContent).toBe("T");
    expect(avatarButton().querySelector("span")!.className).toContain("bg-accent");
    const create = Array.from(container.querySelectorAll("#create-menu a")).map((a) => [a.textContent, a.getAttribute("href")]);
    expect(create).toEqual([["Plan a build", "/tools/talents"], ["Upload addon data", "/upload"], ["New character", "/me"]]);
  });

  it("lists what exists today: Your builds, Your account, API keys, Desktop App and addon, Sign out", async () => {
    await act(async () => root.render(<Header savedBuilds accountSwitching />));
    expect(menuLinks()).toEqual([["Thrall#1", "/account"], ["Your builds", "/me"], ["Your account", "/account"], ["API keys", "/account#keys"], ["Desktop App and addon", "/addon"]]);
    expect(buttons(accountMenu(), "Sign out")).toHaveLength(1);
    expect(container.querySelector('button[aria-label="Switch account"]')).toBeNull();
    expect(accountMenu().textContent).toContain("Thrall#1");
  });

  it("drops Your builds and New character while saved builds are off", async () => {
    await act(async () => root.render(<Header />));
    expect(container.querySelector('a[href="/me"]')).toBeNull();
    expect(menuLinks().slice(1, 3)).toEqual([["Your account", "/account"], ["API keys", "/account#keys"]]);
  });

  it("opens and closes like the other header menus: Escape returns focus, a click outside closes", async () => {
    await act(async () => root.render(<Header />));
    expect(avatarButton().getAttribute("aria-expanded")).toBe("false");
    expect(accountMenu().hidden).toBe(true);
    await act(async () => avatarButton().click());
    expect(avatarButton().getAttribute("aria-expanded")).toBe("true");
    expect(accountMenu().hidden).toBe(false);
    const link = accountMenu().querySelector("a")!;
    link.focus();
    await act(async () => link.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(accountMenu().hidden).toBe(true);
    expect(document.activeElement).toBe(avatarButton());
    await act(async () => avatarButton().click());
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(accountMenu().hidden).toBe(true);

    const plus = container.querySelector<HTMLButtonElement>('button[aria-label="Create new"]')!;
    await act(async () => plus.click());
    expect(plus.getAttribute("aria-expanded")).toBe("true");
    await act(async () => plus.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(plus.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(plus);
  });
});

describe("signed in with a shell", () => {
  it("fetches the shell once and shows name, handle, status and the menu in GitHub's order", async () => {
    const fetch = withShell(shell(), { "/api/me/accounts": () => Response.json([{ userId: ME, displayName: "Jaina Proudmoore", handle: "jaina", current: true }]) });
    await act(async () => root.render(<Header profiles savedBuilds accountSwitching />));
    expect(fetch.mock.calls.filter(([url]) => url === "/api/me/shell")).toHaveLength(1);
    // The accounts on this browser are asked for only once the menu opens.
    expect(fetch.mock.calls.filter(([url]) => url === "/api/me/accounts")).toHaveLength(0);
    await act(async () => avatarButton().click());
    expect(fetch.mock.calls.filter(([url]) => url === "/api/me/accounts")).toHaveLength(1);
    // Initials on the main character's class colour.
    expect(avatarButton().textContent).toBe("JP");
    expect(avatarButton().querySelector("span")!.className).toContain("bg-class-mage");
    expect(accountMenu().textContent).toContain("Jaina Proudmoore");
    expect(accountMenu().textContent).toContain("@jaina");
    expect(container.querySelector('button[aria-label="Switch account"]')).not.toBeNull();
    expect(menuLinks()).toEqual([
      ["Jaina Proudmoore", "/account"],
      ["🔥Raiding Molten Core", "/settings#status"],
      ["Your profile", "/u/jaina"],
      ["Your characters", "/me"],
      ["Your builds", "/me"],
      ["Your account", "/account"],
      ["API keys", "/account#keys"],
      ["Desktop App and addon", "/addon"],
      ["Settings", "/settings"],
      ["Add another account", "/sign-in?add=1"],
    ]);
    expect(buttons(accountMenu(), "Sign out")).toHaveLength(1);
  });

  it("asks for a handle and a status when there are none, and uses the accent without a main character", async () => {
    withShell(shell({ handle: null, status: null, mainCharacterId: null }));
    await act(async () => root.render(<Header profiles />));
    const links = menuLinks();
    expect(links[0]).toEqual(["Jaina Proudmoore", "/account"]);
    expect(links[1]).toEqual(["Choose a handle", "/settings"]);
    expect(links[2]).toEqual(["Set status", "/settings#status"]);
    expect(links[3]).toEqual(["Your profile", "/settings"]);
    expect(avatarButton().querySelector("span")!.className).toContain("bg-accent");
  });

  it("hides Add another account at 5 accounts on this browser, and until the list is known", async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ userId: `0000000${i}-0000-4000-8000-000000000000`, displayName: `A${i}`, handle: null, current: i === 0 }));
    let finish!: (r: Response) => void;
    withShell(shell(), { "/api/me/accounts": () => new Promise<Response>((resolve) => { finish = resolve; }) });
    await act(async () => root.render(<Header profiles accountSwitching />));
    await act(async () => avatarButton().click());
    expect(container.querySelector('a[href="/sign-in?add=1"]')).toBeNull();
    await act(async () => finish(Response.json(five)));
    expect(container.querySelector('a[href="/sign-in?add=1"]')).toBeNull();
    expect(buttons(accountMenu(), "Sign out")).toHaveLength(1);
  });

  it("hides Add another account with the legacy session", async () => {
    withShell(shell());
    await act(async () => root.render(<Header profiles />));
    expect(container.querySelector('a[href="/sign-in?add=1"]')).toBeNull();
  });

  it("keeps today's menu while the shell loads or when the route answers 401 or 404", async () => {
    let finish!: (r: Response) => void;
    api({ "/api/me/shell": () => new Promise<Response>((resolve) => { finish = resolve; }) });
    await act(async () => root.render(<Header profiles savedBuilds accountSwitching />));
    const today = [["Thrall#1", "/account"], ["Your builds", "/me"], ["Your account", "/account"], ["API keys", "/account#keys"], ["Desktop App and addon", "/addon"]];
    expect(menuLinks()).toEqual(today);
    await act(async () => finish(Response.json({ error: "Sign in first." }, { status: 401 })));
    expect(menuLinks()).toEqual(today);
    expect(container.querySelector('button[aria-label="Switch account"]')).toBeNull();
  });

  it("an initial shell (tests) shows at once, then the fetched one replaces it", async () => {
    let finish!: (r: Response) => void;
    api({ "/api/me/shell": () => new Promise<Response>((resolve) => { finish = resolve; }) });
    await act(async () => root.render(<AccountControls profiles initialShell={shell()} />));
    expect(accountMenu().textContent).toContain("@jaina");
    await act(async () => finish(Response.json(shell({ handle: "proudmoore" }))));
    expect(accountMenu().textContent).toContain("@proudmoore");
  });

  it("fetches the shell again when the home or settings announce a change", async () => {
    let current = shell();
    const fetch = api({ "/api/me/shell": () => Response.json(current) });
    await act(async () => root.render(<Header profiles savedBuilds />));
    expect(accountMenu().textContent).toContain("Raiding Molten Core");
    current = shell({ status: null });
    await act(async () => { window.dispatchEvent(new Event(SHELL_CHANGED_EVENT)); });
    expect(fetch.mock.calls.filter(([url]) => url === "/api/me/shell")).toHaveLength(2);
    expect(accountMenu().textContent).not.toContain("Raiding Molten Core");
  });
});

describe("account switcher", () => {
  const accounts: DeviceAccount[] = [
    { userId: ME, displayName: "Jaina Proudmoore", handle: "jaina", current: true },
    { userId: ALT, displayName: "Thrall", handle: null, current: false },
  ];

  it("lists the accounts on this browser with the current one marked, and switches to another", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetch = withShell(shell(), {
      "/api/me/accounts": () => Response.json(accounts),
      "/api/me/accounts/switch": () => Response.json({ ok: true }),
    });
    await act(async () => root.render(<Header profiles accountSwitching />));
    await act(async () => avatarButton().click());
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Switch account"]')!;
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const switcher = container.querySelector("#account-switcher")!;
    expect(switcher.querySelector('[aria-current="true"]')!.textContent).toContain("Jaina Proudmoore");
    const thrall = buttons(switcher, "TThrall")[0];
    expect(thrall).toBeDefined();
    await act(async () => thrall.click());
    for (const [url, init] of fetch.mock.calls) calls.push([url, init]);
    expect(calls.at(-1)).toEqual(["/api/me/accounts/switch", expect.objectContaining({ method: "POST", body: JSON.stringify({ userId: ALT }) })]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("with the legacy session lists only the current account", async () => {
    withShell(shell(), { "/api/me/accounts": () => Response.json([accounts[0]]) });
    await act(async () => root.render(<Header profiles />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Switch account"]')!.click());
    const switcher = container.querySelector("#account-switcher")!;
    expect(switcher.querySelectorAll("li")).toHaveLength(1);
    expect(switcher.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelector('a[href="/sign-in?add=1"]')).toBeNull();
  });

  it("says so when the switch fails, and stays on this account", async () => {
    withShell(shell(), {
      "/api/me/accounts": () => Response.json(accounts),
      "/api/me/accounts/switch": () => Response.json({ error: "That account is not signed in on this browser." }, { status: 404 }),
    });
    await act(async () => root.render(<Header profiles accountSwitching />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Switch account"]')!.click());
    await act(async () => buttons(container.querySelector("#account-switcher")!, "TThrall")[0].click());
    expect(container.querySelector("#account-switcher [role=alert]")?.textContent).toMatch(/could not switch/i);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("sign out", () => {
  it("ends only this account and loads the page as the next one when the server says there is one", async () => {
    withShell(shell(), { "/api/auth/logout": () => Response.json({ ok: true, next: true }) });
    await act(async () => root.render(<Header profiles accountSwitching />));
    await act(async () => buttons(accountMenu(), "Sign out")[0].click());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows Sign in again when no other account is left", async () => {
    withShell(shell(), { "/api/auth/logout": () => Response.json({ ok: true, next: false }) });
    await act(async () => root.render(<Header profiles accountSwitching />));
    await act(async () => buttons(accountMenu(), "Sign out")[0].click());
    expect(reload).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(container.querySelector('a[href="/sign-in"]')).not.toBeNull();
  });
});

describe("helpers", () => {
  it("initials skip the BattleTag number and take two words at most", () => {
    expect(initials("Thrall#1234")).toBe("T");
    expect(initials("jaina proudmoore of kul tiras")).toBe("JP");
    expect(initials("")).toBe("?");
  });

  it("a status reads as unset after its clear time", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    expect(currentStatus({ emoji: null, text: "Busy", clearsAt: "2026-10-20T11:00:00Z" }, now)).toBeNull();
    expect(currentStatus({ emoji: null, text: "Busy", clearsAt: "2026-10-20T13:00:00Z" }, now)?.text).toBe("Busy");
    expect(currentStatus({ emoji: null, text: "", clearsAt: null }, now)).toBeNull();
  });

  it("without saved builds the shell menu keeps profile, account and settings only", () => {
    expect(accountMenuSections(shell(), false).flat().map((l) => l.label)).toEqual(["Your profile", "Your account", "API keys", "Desktop App and addon", "Settings"]);
  });
});
