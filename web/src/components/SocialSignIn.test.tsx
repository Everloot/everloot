// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import SocialSignIn from "./SocialSignIn";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

test("sign-in preserves a safe return path, disables all buttons while pending, and explains a failure", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<SocialSignIn providers={["google", "discord"]} returnTo="/me?save=1" />));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect([...container.querySelectorAll("button")].every((b) => b.disabled)).toBe(true);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/auth/sign-in/social");
  expect(JSON.parse(String(init.body))).toMatchObject({ provider: "google", callbackURL: "/me?save=1", errorCallbackURL: "/sign-in?flow=social&returnTo=%2Fme%3Fsave%3D1" });
  await act(async () => finish(Response.json({ message: "provider internals" }, { status: 500 })));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Try again");
  expect(container.textContent).not.toContain("provider internals");
  expect([...container.querySelectorAll("button")].every((b) => !b.disabled)).toBe(true);
});

test("linking uses the signed-in endpoint and lands in account settings", async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json({}, { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<SocialSignIn providers={["discord"]} mode="link" />));
  expect(container.textContent).toContain("Link Discord");
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(fetcher.mock.calls[0][0]).toBe("/api/auth/link-social");
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toMatchObject({ callbackURL: "/account#sign-in-methods" });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Sign in again");
});

test("network errors and unsafe return paths fail safely", async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => { throw new Error("offline"); });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<SocialSignIn providers={["twitch"]} returnTo="//evil.example" />));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body)).callbackURL).toBe("/account");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});

test("retrying an add-account sign-in keeps its add-account context", async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json({}, { status: 500 }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<SocialSignIn providers={["discord"]} returnTo="/" addAccount />));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body)).errorCallbackURL).toBe("/sign-in?flow=social&returnTo=%2F&add=1&ready=1");
});

test("each button carries its provider's logo and keeps it, and its label, while the sign-in opens", async () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  await act(async () => root.render(<SocialSignIn providers={["google", "microsoft", "twitch", "discord"]} />));
  const buttons = [...container.querySelectorAll("button")];
  expect(buttons.map((b) => b.querySelector("[data-provider-logo]")?.getAttribute("data-provider-logo"))).toEqual(["google", "microsoft", "twitch", "discord"]);
  expect(buttons.every((b) => b.querySelector("[data-provider-logo]")?.getAttribute("aria-hidden") === "true")).toBe(true);
  expect(buttons.map((b) => b.textContent)).toEqual(["Continue with Google", "Sign in with Microsoft", "Continue with Twitch", "Continue with Discord"]);
  await act(async () => buttons[1].click());
  expect(buttons[1].textContent).toBe("Sign in with Microsoft");
  expect(buttons[1].getAttribute("aria-busy")).toBe("true");
  expect(buttons[1].querySelector('[data-provider-logo="microsoft"]')).not.toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Opening Microsoft…");
});

test("Google's button is the dark theme of its guidelines, with Google's own G served from the site", async () => {
  await act(async () => root.render(<SocialSignIn providers={["google"]} mode="link" />));
  const button = container.querySelector("button")!;
  // Google's approved wording even where the other providers say "Link".
  expect(button.textContent).toBe("Continue with Google");
  for (const rule of ["bg-[#131314]", "border-[#8E918F]", "text-[#E3E3E3]", "[font-family:Google_Sans,", "text-[14px]", "leading-5", "font-medium", "h-10", "rounded-full", "px-3", "gap-[10px]"]) {
    expect(button.className).toContain(rule);
  }
  expect(button.className).not.toMatch(/(^| )btn( |$)/);
  const logo = button.querySelector("img")!;
  expect(logo.getAttribute("src")).toBe("/brand/google/g-logo.svg");
  expect([logo.getAttribute("width"), logo.getAttribute("height"), logo.getAttribute("alt")]).toEqual(["20", "20", ""]);
});

test("Microsoft's button follows its dark-theme asset", async () => {
  await act(async () => root.render(<SocialSignIn providers={["microsoft"]} />));
  const button = container.querySelector("button")!;
  for (const rule of ["bg-[#2F2F2F]", "text-[#FFFFFF]", "[font-family:Segoe_UI,", "text-[15px]", "font-semibold", "h-[41px]", "px-3", "gap-3"]) {
    expect(button.className).toContain(rule);
  }
  expect(button.className).not.toContain("rounded");
  expect(button.querySelector("svg")?.getAttribute("width")).toBe("21");
});

test("the G is Google's bundled logo cropped from its dark button, with no button or text left in it", () => {
  const svg = readFileSync("public/brand/google/g-logo.svg", "utf8");
  expect(svg).toMatch(/^<svg width="20" height="20" viewBox="12 10 20 20"/);
  // The G's outline from Google's Sign in with Google bundle (Android + Web, Dark, Pill).
  expect(svg).toContain('<path d="M31.3987 18.1814H21.9849V22.0445H27.3598');
  expect(svg).not.toContain("#131314");
  expect(svg).not.toContain("#E3E3E3");
});
test("the tile layout shows each provider's mark alone, named for assistive technology, and keeps Microsoft as its text button", async () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  await act(async () => root.render(<SocialSignIn providers={["google", "github", "discord", "twitch", "microsoft"]} layout="tiles" />));
  const tiles = [...container.querySelectorAll<HTMLButtonElement>("button[data-provider-tile]")];
  expect(tiles.map((t) => t.dataset.providerTile)).toEqual(["google", "github", "discord", "twitch"]);
  expect(tiles.map((t) => t.getAttribute("aria-label"))).toEqual(["Continue with Google", "Continue with GitHub", "Continue with Discord", "Continue with Twitch"]);
  expect(tiles.map((t) => t.getAttribute("title"))).toEqual(tiles.map((t) => t.getAttribute("aria-label")));
  expect(tiles.every((t) => t.textContent === "")).toBe(true);
  expect(tiles.every((t) => t.querySelector("[data-provider-logo]")?.getAttribute("aria-hidden") === "true")).toBe(true);
  // Google's tile is the icon mode of its dark button; the others are Everloot's control.
  expect(tiles[0].className).toContain("bg-[#131314]");
  expect(tiles[0].className).toContain("border-[#8E918F]");
  expect(tiles[0].querySelector("img")?.getAttribute("width")).toBe("20");
  expect(tiles[1].className).toContain("border-line");
  expect(tiles[1].querySelector("svg")?.getAttribute("width")).toBe("24");
  const buttons = [...container.querySelectorAll("button")];
  const microsoft = buttons[buttons.length - 1];
  expect(microsoft.hasAttribute("data-provider-tile")).toBe(false);
  expect(microsoft.textContent).toBe("Sign in with Microsoft");
  expect(buttons.indexOf(tiles[3])).toBeLessThan(buttons.indexOf(microsoft));
  await act(async () => tiles[1].click());
  expect(tiles[1].getAttribute("aria-busy")).toBe("true");
  expect(buttons.every((b) => b.disabled)).toBe(true);
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Opening GitHub…");
});
