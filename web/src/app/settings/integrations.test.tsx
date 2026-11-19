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

test("Disconnect on a connected key revokes that key through the keys API, after the list's question, and the page reads its parts again", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" });
    return Response.json({ ok: true });
  });
  await act(async () => root.render(<Integrations methods={["battlenet"]} name="Thrall#1234" overview={overview(LIVE)} />));
  await click("Disconnect Drop-rate script (evl_…c0de)");
  expect(container.textContent).toContain("Revoke Drop-rate script? Anything using evl_…c0de stops working at once.");
  expect(document.activeElement).toBe(buttonNamed("Revoke key"));
  await click("Revoke key");
  expect(calls).toEqual([{ url: `/api/keys?id=${SCRIPT}`, method: "DELETE" }]);
  expect(router.refresh).toHaveBeenCalledTimes(1);
  // Its card leaves once the page is read again; focus waits on the list's heading meanwhile.
  expect(document.activeElement).toBe(document.getElementById("apps-heading"));
  // The other key was not touched.
  expect(buttonNamed("Disconnect Desktop App key (evl_…abcd)")).toBeDefined();
});

test("the removal is said in a status line that is on the page before the click and still says it after the card is gone", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ ok: true }));
  await act(async () => root.render(<Integrations methods={["battlenet"]} name="Thrall#1234" overview={overview(LIVE)} />));
  const status = container.querySelector('[role="status"]');
  expect(status?.textContent).toBe("");
  expect(status?.closest("li")).toBeNull();
  await click("Disconnect Drop-rate script (evl_…c0de)");
  await click("Revoke key");
  expect(status!.textContent).toBe("Disconnected Drop-rate script (evl_…c0de).");
  // What the refresh brings: the server renders Integrations again, without that key.
  await act(async () => root.render(<Integrations methods={["battlenet"]} name="Thrall#1234" overview={overview([LIVE[0]])} />));
  expect(buttonNamed("Disconnect Drop-rate script (evl_…c0de)")).toBeUndefined();
  expect(container.querySelector('[role="status"]')).toBe(status);
  expect(status!.textContent).toBe("Disconnected Drop-rate script (evl_…c0de).");
});

test("at 390 px the lists are one column; the second column starts at the sm breakpoint", async () => {
  await act(async () => root.render(<Integrations methods={["battlenet"]} name="Thrall#1234" overview={overview(LIVE)} />));
  for (const id of ["sign-in-heading", "apps-heading", "keys-in-use-heading"]) {
    const list = container.querySelector(`ul[aria-labelledby="${id}"]`)!;
    expect(list.className.split(" ")).toEqual(expect.arrayContaining(["grid", "sm:grid-cols-2"]));
    expect(list.className).not.toMatch(/(?:^|\s)grid-cols-/);
  }
});

const NOW = Date.parse("2026-11-18T12:00:00Z");
/** One card by the name it shows. */
const card = (name: string) => Array.from(container.querySelectorAll("li")).find((li) => li.querySelector("p")?.textContent?.startsWith(name));
const status = (name: string) => card(name)?.querySelector("[data-status]");

test("a live key is Connected with when it was last used, from its own last_used_at; a key never used says so", async () => {
  const keys = [row({ last_used_at: "2026-11-18T10:00:00Z" }), row({ id: SCRIPT, hint: "c0de", label: "Drop-rate script" })];
  await act(async () => root.render(<Integrations methods={["battlenet"]} name="Thrall#1234" overview={overview(keys)} now={NOW} />));
  expect(status("Desktop App key")?.getAttribute("data-status")).toBe("connected");
  expect(status("Desktop App key")?.textContent).toBe("Connected · last used 2 h ago");
  expect(status("Desktop App key")?.querySelector("time")?.getAttribute("dateTime")).toBe("2026-11-18T10:00:00Z");
  expect(status("Drop-rate script")?.textContent).toBe("Connected · never used");
  // Each dot repeats the words in colour: accent for connected.
  expect(status("Drop-rate script")?.querySelector('[aria-hidden="true"]')?.className).toContain("bg-accent");
});

test("Claude and ChatGPT are Not tracked, never Connected: the account has no record of a keyless connector, and the card says so", async () => {
  await act(async () => root.render(<Integrations methods={["battlenet"]} name="Thrall#1234" overview={overview(LIVE)} now={NOW} />));
  for (const name of ["Claude", "ChatGPT"]) {
    expect(status(name)?.getAttribute("data-status")).toBe("off");
    expect(status(name)?.textContent).toBe("Not tracked");
    expect(card(name)?.textContent).toContain(`${name} reaches Everloot's MCP server without a key, so your account keeps no record of it`);
    expect(card(name)?.textContent).toContain(`remove the connector in ${name}`);
    // No Disconnect: there is no key of theirs to revoke.
    expect(card(name)?.querySelector("button")).toBeNull();
  }
});

test("one How to connect drawer per client, closed until opened, each with the MCP address and its docs", async () => {
  await act(async () => root.render(<Integrations methods={["battlenet"]} name="Thrall#1234" overview={overview([])} now={NOW} />));
  const drawers = Array.from(container.querySelectorAll("details[data-how-to]"));
  expect(drawers.map((d) => d.querySelector("summary")?.textContent)).toEqual([
    "How to connect the Desktop App+", "How to connect Claude+", "How to connect ChatGPT+",
  ]);
  for (const d of drawers) expect(d.hasAttribute("open")).toBe(false);
  expect(card("Claude")?.textContent).toContain("https://everloot.app/mcp/public");
  expect(card("Claude")?.querySelector('a[href="/docs/mcp/clients#claude"]')).not.toBeNull();
  expect(card("ChatGPT")?.querySelector('a[href="/docs/mcp/clients#chatgpt"]')).not.toBeNull();
  expect(card("Everloot Desktop App")?.querySelector('a[href="/addon#desktop"]')).not.toBeNull();
  expect(status("Everloot Desktop App")?.textContent).toBe("Not connected");
});

test("keys that cannot be read make the Desktop App an error, not Not connected", async () => {
  await act(async () => root.render(<Integrations methods={["battlenet"]} name="Thrall#1234" overview={null} now={NOW} />));
  expect(status("Everloot Desktop App")?.getAttribute("data-status")).toBe("error");
  expect(status("Everloot Desktop App")?.textContent).toBe("Could not check");
  expect(status("Everloot Desktop App")?.querySelector('[aria-hidden="true"]')?.className).toContain("bg-danger");
  expect(container.textContent).toContain("Your keys could not be read right now");
});
