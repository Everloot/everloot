// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

import ResetPasswordPage from "./page";

const page = (params: { token?: string; error?: string } = {}) => ({ searchParams: Promise.resolve(params) });

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("EVERLOOT_AUTH_V2", "1");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Everloot <hello@everloot.app>");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

const show = async (params: { token?: string; error?: string } = {}) => {
  const tree = await ResetPasswordPage(page(params));
  await act(async () => root.render(tree));
};
const field = (name: string) => container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
const submit = () => act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

test("without a token the page asks for the email and sends the reset link back to this page", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  await show();
  expect(field("email")?.getAttribute("autocomplete")).toBe("email");
  expect(field("password")).toBeNull();
  const button = container.querySelector("button")!;
  expect(button.textContent).toBe("Send reset link");
  field("email")!.value = "jaina@example.com";
  await submit();
  expect(button.textContent).toBe("Sending…");
  expect(button.disabled).toBe(true);
  expect(fetcher.mock.calls[0][0]).toBe("/api/auth/request-password-reset");
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toEqual({ email: "jaina@example.com", redirectTo: "/reset-password" });
  await act(async () => finish(Response.json({ status: true })));
  // The same answer whether or not the email has an account.
  expect(container.querySelector('[role="status"]')?.textContent).toBe("If that email has an Everloot account, a reset link is on its way.");
  expect(container.querySelector("form")).toBeNull();
});

test("with the token from the email the page asks for the new password and posts it with the token", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  await show({ token: "tok_123" });
  expect(field("email")).toBeNull();
  const password = field("password")!;
  expect([password.type, password.getAttribute("autocomplete"), password.minLength]).toEqual(["password", "new-password", 10]);
  expect(container.textContent).toContain("New password");
  expect(container.textContent).toContain("At least 10 characters.");
  const button = container.querySelector("button")!;
  expect(button.textContent).toBe("Save new password");
  password.value = "kul-tiras-forever";
  await submit();
  expect(button.textContent).toBe("Saving…");
  expect(fetcher.mock.calls[0][0]).toBe("/api/auth/reset-password");
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toEqual({ newPassword: "kul-tiras-forever", token: "tok_123" });
  await act(async () => finish(Response.json({ status: true })));
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Your password is changed. Sign in with the new one.");
});

test("a refused new password keeps the form, says why, and lets the player try again", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "Invalid token" }, { status: 400 })));
  await show({ token: "used" });
  field("password")!.value = "kul-tiras-forever";
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Invalid token");
  const button = container.querySelector("button")!;
  expect([button.textContent, button.disabled]).toEqual(["Save new password", false]);
});

test("an expired link offers a new one, and without email accounts neither form shows", async () => {
  const expired = renderToStaticMarkup(await ResetPasswordPage(page({ token: "t", error: "INVALID_TOKEN" })));
  expect(expired).toContain("That link has expired or was already used.");
  expect(expired).toContain('href="/reset-password"');
  expect(expired).not.toContain("<form");
  vi.stubEnv("EVERLOOT_AUTH_V2", "0");
  const closed = renderToStaticMarkup(await ResetPasswordPage(page({ token: "t" })));
  expect(closed).toContain("Email accounts are not open yet.");
  expect(closed).not.toContain("<form");
});
