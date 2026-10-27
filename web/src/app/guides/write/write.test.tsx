import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));
// Every class reads the made-up test tree, not game data.
vi.mock("@/lib/talents/catalogs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/talents/catalogs")>();
  const { fixture } = await import("@/lib/talents/fixture");
  return { ...real, loadCatalog: async (slug: string) => ({ ...fixture, classSlug: slug }) };
});

import WritePage, { metadata } from "./page";
import { fixture } from "@/lib/talents/fixture";
import { encodeBuild, encodeOrder } from "@/lib/talents/share";
import type { Ranks } from "@/lib/talents/types";

const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1234" };
const GUIDE = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";
const OTHER_GUIDE = "9b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e99";
const RANKS: Ranks = { 11: { rank: 5 }, 21: { rank: 1 } };
const CODE = encodeBuild({ classSlug: "mage", specId: fixture.specId, build: fixture.build, ranks: RANKS });
const PROVISIONAL = encodeOrder(RANKS, [11, 11, 11, 11, 11, 21], "provisional")!;
const SOURCE = "https://worldofwarcraft.blizzard.com/en-us/news/24302498";
const BODY = [
  "## Who it is for", "",
  "<script>alert(1)</script> Players who **level** alone. [evil](//evil.example/x) [back](/\\evil.example) [js](javascript:alert(1)) "
    + `[the post](${SOURCE}) [not listed](https://evil.example/page) [the calculator](/tools/talents)`, "",
  "## Why this plan", "", "<img src=x onerror=alert(1)> Because it works.", "",
  "## How to play it", "", "Spend the points.", "",
  "## What we do not know yet", "", "Much.",
].join("\n");

const summaryRow = (revision: number, status: string, over: object = {}) => ({
  guide_id: GUIDE, revision, status, title: "Frost leveling", author_handle: status === "draft" ? null : "thrall",
  updated_at: `2026-10-2${revision}T10:00:00+00:00`, submitted_at: status === "draft" ? null : `2026-10-2${revision}T10:00:00+00:00`, withdrawn_at: null, ...over,
});
let summaries: object[];
let newest: Record<string, unknown> | null;
let profile: { handle: string | null; public_profile: boolean } | null;

beforeEach(() => {
  vi.stubEnv("EVERLOOT_GUIDE_SUBMISSIONS", "1");
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  profile = { handle: "thrall", public_profile: false };
  summaries = [summaryRow(2, "draft"), summaryRow(1, "submitted"), summaryRow(1, "withdrawn", { guide_id: OTHER_GUIDE, title: "Shadow dungeons" })];
  newest = {
    guide_id: GUIDE, revision: 2, status: "draft", title: "Frost <b>leveling</b>", summary: "A plan for leveling a mage on your own.",
    class_slug: "mage", activity: "leveling", roles: ["damage"], level_from: 10, level_to: 60, code: CODE, point_order: PROVISIONAL,
    code2: null, point_order2: null, sources: [{ title: "Blizzard's announcement", url: SOURCE, checkedOn: "2026-10-19" }], body: BODY,
    author_handle: null, updated_at: "2026-10-22T10:00:00+00:00", submitted_at: null, withdrawn_at: null,
  };
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith("user_profiles?")) {
      return profile ? [{
        handle: profile.handle, display_name: null, status_emoji: null, status_text: null, status_clears_at: null, public_profile: profile.public_profile,
        show_characters: true, show_builds: true, show_status: true, main_character_id: null, active_character_id: null,
      }] : [];
    }
    if (path.startsWith("guide_submission_revisions?") && path.includes("guide_id=eq.")) return newest && path.includes(`guide_id=eq.${newest.guide_id}`) ? [newest] : [];
    if (path.startsWith("guide_submission_revisions?")) return summaries;
    throw new Error(`Unexpected storage call: ${path}`);
  });
});
afterEach(() => { vi.unstubAllEnvs(); });

const page = async (query: Record<string, string> = {}) => renderToStaticMarkup(await WritePage({ searchParams: Promise.resolve(query) }));

test("off: a 404 and nothing is read; signed out: sign in and come back", async () => {
  for (const [guides, profiles] of [[undefined, "1"], ["true", "1"], ["1", undefined]]) {
    vi.stubEnv("EVERLOOT_GUIDE_SUBMISSIONS", guides);
    vi.stubEnv("EVERLOOT_PROFILES", profiles);
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
  }
  expect(auth.getUser).not.toHaveBeenCalled();
  vi.stubEnv("EVERLOOT_GUIDE_SUBMISSIONS", "1");
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  auth.getUser.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("NEXT_REDIRECT /sign-in?returnTo=%2Fguides%2Fwrite");
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("never indexed", () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
});

test("only the signed-in account's guides: another account's or a made-up id is a 404", async () => {
  newest = null;
  await expect(page({ guide: "9c6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e77" })).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(page({ guide: "not-an-id" })).rejects.toThrow("NEXT_NOT_FOUND");
  for (const [path] of auth.authQuery.mock.calls) expect(path).toContain(`user_id=eq.${USER.id}`);
});

test("lists the account's guides by their newest revision, and a new guide opens empty", async () => {
  const html = await page();
  expect(html).toContain(`href="/guides/write?guide=${GUIDE}"`);
  expect(html).toContain(`href="/guides/write?guide=${OTHER_GUIDE}"`);
  expect(html).toMatch(/Frost leveling<\/a>[^<]*<span[^>]*>Draft, revision 2<\/span>/);
  expect(html).toMatch(/Shadow dungeons<\/a>[^<]*<span[^>]*>Withdrawn, revision 1<\/span>/);
  expect(html).toMatch(/aria-label="Title"[^>]* value=""/);
  expect(html).not.toContain('id="preview"');
  expect(html).toContain("Community guides are not published yet.");
});

test("an open draft is edited in place, and its preview is drawn by the guides' own renderer: HTML stays text and only safe links are drawn", async () => {
  const html = await page({ guide: GUIDE });
  expect(html).toMatch(/aria-label="Title"[^>]* value="Frost &lt;b&gt;leveling&lt;\/b&gt;"/);
  const preview = html.slice(html.indexOf('id="preview"'));
  expect(preview).toContain("Frost &lt;b&gt;leveling&lt;/b&gt;");
  expect(preview).toContain("&lt;script&gt;alert(1)&lt;/script&gt; Players who <strong>level</strong> alone.");
  expect(preview).toContain("&lt;img src=x onerror=alert(1)&gt; Because it works.");
  expect(preview).not.toMatch(/<(script|img|iframe)\b/);
  // A listed source and a page on this site are links; another site, a protocol-relative or backslash address and a
  // script address are words.
  expect(preview).toContain(`<a href="${SOURCE}" rel="noopener">the post</a>`);
  expect(preview).toContain('<a href="/tools/talents">the calculator</a>');
  for (const words of ["evil", "back", "not listed"]) expect(preview).toContain(` ${words} `);
  expect(preview).toContain("[js](javascript:alert(1))");
  expect(preview).not.toMatch(/href="(\/\/|\/\\|javascript:|https:\/\/evil)/);
});

test("the preview names the author by handle only, says what must change before submitting, and offers withdrawal of the waiting revision", async () => {
  const html = await page({ guide: GUIDE });
  const preview = html.slice(html.indexOf('id="preview"'));
  expect(preview).toContain("By @thrall");
  expect(preview).toContain("Before it can be submitted");
  expect(preview).toContain("provisional (O1g)");
  expect(preview).toContain("Raw HTML is not allowed");
  expect(html).not.toContain("Thrall#1234");
  expect(html).toContain("Revision 1 is waiting for review.");
  expect(html).toContain("Withdraw revision 1 from review");

  profile = { handle: null, public_profile: false };
  const nameless = await page({ guide: GUIDE });
  expect(nameless).toContain("No author name yet");
  expect(nameless).toContain('href="/settings"');
  expect(nameless).not.toContain("By @");
  expect(nameless).not.toContain("Thrall");
});

test("storage down: says so instead of an empty list", async () => {
  auth.authQuery.mockRejectedValue(new Error("down"));
  const html = await page();
  expect(html).toContain("Your guide drafts are unavailable right now. Try again in a minute.");
});
