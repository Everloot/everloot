// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import BugReport from "./BugReport";

let path = "/database/items/19019";
vi.mock("next/navigation", () => ({ usePathname: () => path }));
let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  path = "/database/items/19019";
  window.history.replaceState(null, "", `${path}?key=secret#private`);
  // jsdom has no native dialog behavior; browser verification covers the focus trap and Escape.
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event("close")); };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<BugReport />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const trigger = () => container.querySelector<HTMLButtonElement>('button[aria-label="Report a bug"]')!;
const dialog = () => container.querySelector("dialog")!;
const open = async () => { trigger().focus(); await act(async () => trigger().click()); };
const report = () => new URL(container.querySelector<HTMLAnchorElement>('a[href^="https://github.com/Everloot/everloot/issues/new?"]')!.href);

test("visible bug control opens a named dialog with support alternatives", async () => {
  expect(trigger().querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  expect(dialog().open).toBe(false);
  await open();
  expect(dialog().open).toBe(true);
  expect(dialog().getAttribute("aria-labelledby")).toBe("bug-report-heading");
  expect(dialog().textContent).toContain("GitHub account");
  expect(dialog().querySelector('a[href="https://discord.gg/9CKsbHTRu3"]')).not.toBeNull();
  expect(dialog().querySelector('a[href="mailto:hello@everloot.app"]')).not.toBeNull();
  for (const a of dialog().querySelectorAll('a[target="_blank"]')) expect(a.getAttribute("rel")).toContain("noreferrer");
});

test("prepares the existing bug form with the public page, excluding query and fragment", async () => {
  await open();
  expect(report().searchParams.get("template")).toBe("bug-report.yml");
  expect(report().searchParams.get("page")).toBe("https://everloot.app/database/items/19019");
  expect(report().href).not.toMatch(/secret|private/);
  expect(dialog().textContent).toContain("https://everloot.app/database/items/19019");
});

test.each(["/chat/private-conversation", "/settings", "/account/connect/secret", "/tools/builds/private-id", "/sign-in", "/sign-up", "/reset-password", "/desktop/connect", "/invite/private-token"])("omits the private URL on %s", async (route) => {
  path = route;
  window.history.replaceState(null, "", `${path}?token=secret#key`);
  await act(async () => root.render(<BugReport />));
  await open();
  expect(report().searchParams.get("page")).toBe("Private page (URL omitted)");
  expect(report().href).not.toContain(encodeURIComponent(route));
});

test("closing restores focus and the previous body scroll style, keeping the report unsubmitted", async () => {
  document.body.style.overflow = "auto";
  await open();
  expect(document.body.style.overflow).toBe("hidden");
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Close bug report"]')!.click());
  expect(dialog().open).toBe(false);
  expect(document.activeElement).toBe(trigger());
  expect(document.body.style.overflow).toBe("auto");
  document.body.style.overflow = "";
});

test("Tab and Shift+Tab wrap between the dialog's first and last controls", async () => {
  await open();
  const first = dialog().querySelector<HTMLButtonElement>("button")!;
  const last = dialog().querySelector<HTMLAnchorElement>('a[href^="mailto:"]')!;
  first.focus();
  await act(async () => first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(last);
  await act(async () => last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(first);
});

test("a page change closes the dialog and the next report uses the new page", async () => {
  await open();
  path = "/map";
  window.history.replaceState(null, "", path);
  await act(async () => root.render(<BugReport />));
  expect(dialog().open).toBe(false);
  await open();
  expect(report().searchParams.get("page")).toBe("https://everloot.app/map");
});
