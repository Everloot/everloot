// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("@/lib/supabase/server", () => ({ getUser: vi.fn(), authQuery: vi.fn(), siteUrl: () => "https://everloot.app" }));

import GuideEditor from "./GuideEditor";
import { GUIDE_LIMITS, emptyDraft, guideEditorOptions, type GuideDraft } from "@/lib/guide-submissions";

const OWNER = "11111111-2222-4333-8444-555555555555";
const GUIDE = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";
const CODE = "EL1-mage-1482-1.0.0.1-MTE6NQ";
const SOURCE = { title: "Blizzard's announcement", url: "https://worldofwarcraft.blizzard.com/en-us/news/24302498", checkedOn: "2026-10-19" };
const SAVED: GuideDraft = {
  ...emptyDraft(), title: "Frost leveling", summary: "A plan for leveling a mage.", classSlug: "mage", activity: "leveling",
  roles: ["damage"], levels: { from: 10, to: 60 }, code: CODE, order: "O1p-AAAAAF", sources: [SOURCE], body: "## Who it is for\n\nPlayers.",
};

let container: HTMLDivElement;
let root: Root;
/** Answers for the next requests, in order; a request with none left gets a 200 with an empty body. */
let answers: Array<{ status: number; body: object }>;
/** Every request the editor sent: its address, method, JSON body and the account it named. */
let sent: Array<{ url: string; method: string; body: Record<string, unknown>; owner: string | null; type: string | null }>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  answers = [];
  sent = [];
  router.push.mockReset();
  router.refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    sent.push({ url: String(url), method: init.method ?? "GET", body: JSON.parse(String(init.body)), owner: headers.get("x-everloot-expected-owner"), type: headers.get("content-type") });
    const answer = answers.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

type Props = Parameters<typeof GuideEditor>[0];
let renders = 0;
/** A fresh editor each time, as a page load gives one. */
function render(props: Partial<Props> = {}) {
  const base: Props = {
    ownerId: OWNER, guideId: null, draft: emptyDraft(), revision: 1, waiting: null,
    author: { handle: "thrall", publicProfile: false }, options: guideEditorOptions(), limits: GUIDE_LIMITS,
  };
  act(() => root.render(<GuideEditor key={++renders} {...base} {...props} />));
}

const text = () => container.textContent ?? "";
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const field = <T extends HTMLElement = HTMLInputElement>(label: string) => {
  const el = container.querySelector<T>(`[aria-label="${label}"]`);
  if (!el) throw new Error(`No field ${label} in: ${text()}`);
  return el;
};
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) ?? null;
async function click(label: string) {
  const b = button(label);
  if (!b) throw new Error(`No button ${label} in: ${text()}`);
  await act(async () => { b.click(); });
  await settle();
}
async function type(label: string, value: string) {
  const el = field<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(label);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

test("a new guide opens with the four sections, the limits on every field, and no way to submit before it is saved", () => {
  render();
  expect(field<HTMLTextAreaElement>("Text").value).toBe("## Who it is for\n\n\n\n## Why this plan\n\n\n\n## How to play it\n\n\n\n## What we do not know yet\n\n");
  expect(field("Title").maxLength).toBe(90);
  expect(field("Summary").maxLength).toBe(300);
  expect(field<HTMLTextAreaElement>("Text").maxLength).toBe(20_000);
  expect(field("Share code").maxLength).toBe(400);
  expect(field("From level").max).toBe("100");
  expect([...field<HTMLSelectElement>("Class").options].map((o) => o.value)).toEqual(["", "warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"]);
  expect([...field<HTMLSelectElement>("Activity").options].map((o) => o.textContent)).toEqual(["Pick an activity", "Leveling", "Dungeons", "Raids"]);
  expect(button("Submit for review…")).toBeNull();
  expect(text()).toContain("Save the draft before you submit it.");
  expect(text()).toContain("Your drafts are private");
});

test("saving sends the draft as the signed-in account, then opens the new guide", async () => {
  render();
  answers = [{ status: 201, body: { guideId: GUIDE, revision: 1, status: "draft" } }];
  await type("Title", "Frost leveling");
  await type("Summary", "A plan for leveling a mage.");
  await type("Class", "mage");
  await type("Activity", "leveling");
  await act(async () => { field("Damage").click(); });
  await type("From level", "10");
  await type("To level", "60");
  await type("Share code", CODE);
  await type("Spend order", "O1p-AAAAAF");
  await click("Add a source");
  await type("Source 1 title", SOURCE.title);
  await type("Source 1 address", SOURCE.url);
  await type("Source 1 checked on", SOURCE.checkedOn);
  await type("Text", "## Who it is for\n\nPlayers.");
  await click("Save draft");
  expect(sent).toEqual([{
    url: "/api/me/guides", method: "POST", owner: OWNER, type: "application/json",
    body: { action: "save", guideId: null, draft: SAVED },
  }]);
  expect(router.push).toHaveBeenCalledWith(`/guides/write?guide=${GUIDE}`);
  expect(text()).toContain("Saved.");
});

test("a saved draft saves in place, a source can be taken out, and the preview below is refreshed", async () => {
  render({ guideId: GUIDE, draft: { ...SAVED, sources: [SOURCE, { ...SOURCE, title: "Second" }] }, revision: 2 });
  await click("Remove source 1");
  await click("Save draft");
  expect(sent[0].body).toEqual({ action: "save", guideId: GUIDE, draft: { ...SAVED, sources: [{ ...SOURCE, title: "Second" }] } });
  expect(router.refresh).toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
});

test("submitting shows the name the guide will carry before anything is sent; a private profile stays private", async () => {
  render({ guideId: GUIDE, draft: SAVED, revision: 2 });
  await click("Submit for review…");
  expect(sent).toEqual([]);
  const panel = container.querySelector('[aria-label="Submit for review"]')!;
  expect(panel.textContent).toContain("This guide will name you as @thrall, never by your BattleTag.");
  expect(panel.textContent).toContain("Your profile stays private: the name is shown without a link to it.");
  expect(panel.textContent).toContain("It sends revision 2 exactly as it is now. Nothing is published yet: community guides wait for review.");
  answers = [{ status: 200, body: { guideId: GUIDE, revision: 2, status: "submitted" } }];
  await click("Submit revision 2");
  expect(sent).toEqual([{ url: "/api/me/guides", method: "POST", owner: OWNER, type: "application/json", body: { action: "submit", guideId: GUIDE, draft: SAVED, alias: "thrall" } }]);
  expect(router.refresh).toHaveBeenCalled();
  expect(text()).toContain("Revision 2 is waiting for review.");

  // A public profile: the name links to it.
  render({ guideId: GUIDE, draft: SAVED, revision: 3, author: { handle: "thrall", publicProfile: true } });
  await click("Submit for review…");
  expect(container.querySelector('[aria-label="Submit for review"]')!.textContent).toContain("While your profile is public, the name links to /u/thrall.");
  await click("Cancel");
  expect(container.querySelector('[aria-label="Submit for review"]')).toBeNull();
});

test("without a handle, submitting points to Settings and sends nothing", async () => {
  render({ guideId: GUIDE, draft: SAVED, revision: 2, author: { handle: null, publicProfile: false } });
  await click("Submit for review…");
  const panel = container.querySelector('[aria-label="Submit for review"]')!;
  expect(panel.textContent).toContain("Choose a handle on Settings first: a guide names its author by handle, never by BattleTag.");
  expect(panel.querySelector('a[href="/settings"]')).not.toBeNull();
  expect(button("Submit revision 2")).toBeNull();
  expect(sent).toEqual([]);
});

test("a refused submit lists what to fix; a write for another account says nothing was saved and goes nowhere", async () => {
  render({ guideId: GUIDE, draft: SAVED, revision: 2 });
  answers = [{ status: 422, body: { error: "Fix these before you submit:", problems: ["order is provisional (O1g)", "Line 3 of the text: sources.0 is not cited"] } }];
  await click("Submit for review…");
  await click("Submit revision 2");
  const alert = container.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("Fix these before you submit:");
  expect([...alert.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["order is provisional (O1g)", "Line 3 of the text: sources.0 is not cited"]);
  expect(router.refresh).not.toHaveBeenCalled();

  answers = [{ status: 409, body: { error: "This was meant for another account than the one signed in now. Nothing was saved.", code: "account_mismatch" } }];
  await click("Save draft");
  expect(container.querySelector('[role="alert"]')!.textContent).toBe("You are signed in to another account now. Nothing was saved. Reload the page to go on.");
  expect(router.refresh).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();

  answers = [{ status: 401, body: { error: "Sign in to write guides.", signIn: "/sign-in?returnTo=%2Fguides%2Fwrite" } }];
  await click("Save draft");
  expect(container.querySelector('[role="alert"]')!.textContent).toContain("Sign in to write guides.");
  expect(container.querySelector('[role="alert"] a[href="/sign-in?returnTo=%2Fguides%2Fwrite"]')).not.toBeNull();
});

test("a revision waiting for review can be withdrawn", async () => {
  render({ guideId: GUIDE, draft: SAVED, revision: 2, waiting: 1 });
  expect(text()).toContain("Revision 1 is waiting for review.");
  answers = [{ status: 200, body: { guideId: GUIDE, revision: 1, status: "withdrawn" } }];
  await click("Withdraw revision 1 from review");
  expect(sent).toEqual([{ url: "/api/me/guides", method: "POST", owner: OWNER, type: "application/json", body: { action: "withdraw", guideId: GUIDE, revision: 1 } }]);
  expect(router.refresh).toHaveBeenCalled();
});

test("an editor kept across a change of account starts again for the new one, whatever key it is given", async () => {
  const OTHER = "22222222-3333-4444-8555-666666666666";
  const props: Props = {
    ownerId: OWNER, guideId: null, draft: emptyDraft(), revision: 1, waiting: null,
    author: { handle: "thrall", publicProfile: false }, options: guideEditorOptions(), limits: GUIDE_LIMITS,
  };
  act(() => root.render(<GuideEditor key="kept" {...props} />));
  await type("Title", "Private words of the first account");
  act(() => root.render(<GuideEditor key="kept" {...props} ownerId={OTHER} author={{ handle: "jaina", publicProfile: false }} />));
  expect(field("Title").value).toBe("");
  await click("Save draft");
  expect(sent.map((s) => [s.owner, (s.body.draft as GuideDraft).title])).toEqual([[OTHER, ""]]);
});

test("text that looks like HTML stays text in every field: no element is made from it", () => {
  const html = '<img src=x onerror="alert(1)"><script>alert(1)</script><iframe src="https://evil.example"></iframe>';
  render({ guideId: GUIDE, draft: { ...SAVED, title: html, summary: html, body: html, sources: [{ ...SOURCE, title: html }] }, revision: 2 });
  expect(container.querySelector("img, script, iframe")).toBeNull();
  expect(field("Title").value).toBe(html);
  expect(field<HTMLTextAreaElement>("Text").value).toBe(html);
  expect(field("Source 1 title").value).toBe(html);
});
