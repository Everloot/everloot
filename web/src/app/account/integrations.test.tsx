// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AccountOverview } from "@/lib/account-overview";
import type { KeyRow } from "@/lib/api-keys";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

import Integrations from "./integrations";

const DESKTOP = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SCRIPT = "cccccccc-3333-4333-8333-cccccccccccc";
const row = (over: Partial<KeyRow>): KeyRow => ({
  id: DESKTOP, hint: "abcd", label: "Everloot Desktop App", scopes: ["read:public"], created_at: "2026-10-10T00:00:00Z",
  last_used_at: null, revoked_at: null, expires_at: null, ...over,
});
const LIVE = [row({}), row({ id: SCRIPT, hint: "c0de", label: "Drop-rate script" })];
const overview = (liveKeys: KeyRow[]): AccountOverview => ({
  memberSince: null, profile: null, characters: null, builds: null,
  keys: { live: liveKeys.length, requests: 0, desktop: liveKeys.some((k) => k.label === "Everloot Desktop App"), liveKeys },
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("EVERLOOT_DATA_GUARD", "1");
  router.refresh.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const buttonNamed = (name: string) => Array.from(container.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === name || b.textContent === name);
const click = async (name: string) => act(async () => buttonNamed(name)!.click());

test("Remove access on a connected key revokes that key through the keys API, after the list's question, and the page reads its parts again", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" });
    return Response.json({ ok: true });
  });
  await act(async () => root.render(<Integrations methods={["battlenet"]} name="Thrall#1234" overview={overview(LIVE)} />));
  await click("Remove access for Drop-rate script");
  expect(container.textContent).toContain("Revoke Drop-rate script? Anything using evl_…c0de stops working at once.");
  expect(document.activeElement).toBe(buttonNamed("Revoke key"));
  await click("Revoke key");
  expect(calls).toEqual([{ url: `/api/keys?id=${SCRIPT}`, method: "DELETE" }]);
  expect(router.refresh).toHaveBeenCalledTimes(1);
  // Its card leaves once the page is read again; focus waits on the list's heading meanwhile.
  expect(document.activeElement).toBe(document.getElementById("connected-heading"));
  // The other key was not touched.
  expect(buttonNamed("Remove access for Everloot Desktop App")).toBeDefined();
});

test("at 390 px the lists are one column; the second column starts at the sm breakpoint", async () => {
  await act(async () => root.render(<Integrations methods={["battlenet"]} name="Thrall#1234" overview={overview(LIVE)} />));
  for (const id of ["connected-heading", "available-heading"]) {
    const list = container.querySelector(`ul[aria-labelledby="${id}"]`)!;
    expect(list.className.split(" ")).toEqual(expect.arrayContaining(["grid", "sm:grid-cols-2"]));
    expect(list.className).not.toMatch(/(?:^|\s)grid-cols-/);
  }
});
