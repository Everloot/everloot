// @vitest-environment jsdom
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
