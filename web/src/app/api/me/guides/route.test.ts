import { afterEach, beforeEach, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));
// Every class reads the made-up test tree, not game data.
vi.mock("@/lib/talents/catalogs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/talents/catalogs")>();
  const { fixture } = await import("@/lib/talents/fixture");
  return { ...real, loadCatalog: async (slug: string) => ({ ...fixture, classSlug: slug }) };
});

import { GET, POST } from "./route";
import { fixture } from "@/lib/talents/fixture";
import { encodeBuild, encodeOrder } from "@/lib/talents/share";
import type { Ranks } from "@/lib/talents/types";

const SITE = "https://everloot.app";
const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1234" };
const OTHER = "22222222-3333-4444-8555-666666666666";
const GUIDE = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";

// The test tree: Talent 11 on the first row, Talent 21 on the second, which opens at 5 points above.
const RANKS: Ranks = { 11: { rank: 5 }, 21: { rank: 1 } };
const code = (ranks: Ranks, classSlug = "mage") => encodeBuild({ classSlug, specId: fixture.specId, build: fixture.build, ranks });
const CODE = code(RANKS);
const PLANNED = encodeOrder(RANKS, [11, 11, 11, 11, 11, 21], "planned")!;
const PROVISIONAL = encodeOrder(RANKS, [11, 11, 11, 11, 11, 21], "provisional")!;
const OUT_OF_ORDER = encodeOrder(RANKS, [21, 11, 11, 11, 11, 11], "planned")!;
const SOURCE = "https://worldofwarcraft.blizzard.com/en-us/news/24302498";
const SOURCES = [{ title: "Blizzard's announcement", url: SOURCE, checkedOn: "2026-10-19" }];
// Test text, not advice.
const filler = (n: number) => Array.from({ length: n }, (_, i) => ["stone", "river", "road", "hill", "mine"][i % 5]).join(" ");
const BODY = [
  "## Who it is for", "", `Players who level a mage on their own and want every point placed before the next level arrives. ${filler(30)}`, "",
  "## Why this plan", "", `Blizzard [named the class changes](${SOURCE}) that shape this plan. ${filler(40)}`, "",
  "## How to play it", "", `At level 10, put 5 points in Talent 11, then take Talent 21 at level 15. ${filler(40)}`, "",
  "## What we do not know yet", "", `Whether the point levels hold in the live game is not confirmed. ${filler(20)}`,
].join("\n");
const DRAFT = {
  title: "Frost leveling", summary: "A plan for leveling a mage on your own, in the order we spend each point.",
  classSlug: "mage", activity: "leveling", roles: ["damage"], levels: { from: 10, to: 60 },
  code: CODE, order: PLANNED, code2: null, order2: null, sources: SOURCES, body: BODY,
};

const NEEDS_HANDLE = "Choose a handle on your settings page first. A guide names its author by handle, never by BattleTag.";
const ALIAS_CHANGED = "Your handle changed since you checked the name this guide carries. Check it and submit again.";
const NOT_READY = "Fix these before you submit:";
const SOURCE_SHAPE = "Each source is a title, an https address and the day you checked it (YYYY-MM-DD).";

const post = (body: unknown, { origin = SITE as string | null, headers = {} as Record<string, string> } = {}) =>
  POST(new Request(`${SITE}/api/me/guides`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin === null ? {} : { origin }), ...headers },
    body: JSON.stringify(body),
  }));
const list = (headers: Record<string, string> = {}, query = "") => GET(new Request(`${SITE}/api/me/guides${query}`, { headers }));

let profile: { handle: string | null; public_profile: boolean } | null;
let rows: object[];
let rpc: Record<string, unknown>;
/** Every call the site made to storage, with its parsed body. */
const calls = () => auth.authQuery.mock.calls.map(([path, init]) => ({
  path: path as string, ...((init as RequestInit | undefined)?.body ? { body: JSON.parse(String((init as RequestInit).body)) } : {}),
}));
const writes = () => calls().filter((c) => c.path.startsWith("rpc/"));

beforeEach(() => {
  vi.stubEnv("EVERLOOT_GUIDE_SUBMISSIONS", "1");
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  profile = { handle: "thrall", public_profile: false };
  rows = [];
  rpc = {};
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith("user_profiles?")) {
      return profile ? [{
        handle: profile.handle, display_name: null, status_emoji: null, status_text: null, status_clears_at: null,
        public_profile: profile.public_profile, show_characters: true, show_builds: true, show_status: true,
        main_character_id: null, active_character_id: null,
      }] : [];
    }
    if (path.startsWith("guide_submission_revisions?")) return rows;
    const name = path.replace(/^rpc\//, "");
    if (name in rpc) return rpc[name];
    throw new Error(`Unexpected storage call: ${path}`);
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("with the switch off, or without profiles, every request is a 404 and nothing is read", async () => {
  for (const [guides, profiles] of [[undefined, "1"], ["true", "1"], ["0", "1"], ["1", undefined], ["1", "0"]]) {
    vi.stubEnv("EVERLOOT_GUIDE_SUBMISSIONS", guides);
    vi.stubEnv("EVERLOOT_PROFILES", profiles);
    expect((await list()).status).toBe(404);
    expect((await post({ action: "save", guideId: null, draft: DRAFT })).status).toBe(404);
  }
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("signed out is a 401 with where to sign in; nothing is read or written", async () => {
  auth.getUser.mockResolvedValue(null);
  for (const res of [await list(), await post({ action: "save", guideId: null, draft: DRAFT })]) {
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ error: "Sign in to write guides.", signIn: "/sign-in?returnTo=%2Fguides%2Fwrite" });
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("a write from another site, or with no Origin, is a 403 before the session is read", async () => {
  for (const origin of [null, "null", "https://evil.example", "https://everloot.app.evil.example", "http://everloot.app"]) {
    const res = await post({ action: "save", guideId: null, draft: DRAFT }, { origin });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Invalid origin" });
  }
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("a request that names another account than the session's is a 409, and nothing is read or written", async () => {
  const other = { "x-everloot-expected-owner": OTHER };
  for (const res of [await list(other), await post({ action: "save", guideId: null, draft: DRAFT }, { headers: other })]) {
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "This was meant for another account than the one signed in now. Nothing was saved.", code: "account_mismatch",
    });
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
  // The session's own account goes through.
  rpc.save_guide_draft = { guide_ref: GUIDE, revision: 1, created: true, refusal: null };
  expect((await post({ action: "save", guideId: null, draft: DRAFT }, { headers: { "x-everloot-expected-owner": USER.id } })).status).toBe(201);
});

test("the list is the session's own guides, private and never cached, and names the author by handle, never the BattleTag", async () => {
  rows = [
    { guide_id: GUIDE, revision: 2, status: "draft", title: "Frost leveling", author_handle: null,
      updated_at: "2026-10-27T10:00:00+00:00", submitted_at: null, withdrawn_at: null },
    { guide_id: GUIDE, revision: 1, status: "submitted", title: "Frost leveling", author_handle: "thrall",
      updated_at: "2026-10-26T10:00:00+00:00", submitted_at: "2026-10-26T10:00:00+00:00", withdrawn_at: null },
  ];
  // An owner named in the address changes nothing: the session's account is the only one read.
  const res = await list({}, `?user_id=eq.${OTHER}&userId=${OTHER}`);
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  const body = await res.json();
  expect(body).toEqual({
    guides: [{
      id: GUIDE,
      revisions: [
        { revision: 2, status: "draft", title: "Frost leveling", author: null, updatedAt: "2026-10-27T10:00:00.000Z", submittedAt: null, withdrawnAt: null },
        { revision: 1, status: "submitted", title: "Frost leveling", author: "thrall", updatedAt: "2026-10-26T10:00:00.000Z",
          submittedAt: "2026-10-26T10:00:00.000Z", withdrawnAt: null },
      ],
    }],
    author: { handle: "thrall", publicProfile: false },
  });
  for (const { path } of calls()) {
    expect(path).toContain(`user_id=eq.${USER.id}`);
    expect(path).not.toContain(OTHER);
  }
  expect(JSON.stringify(body)).not.toContain("Thrall#1234");
  // No handle yet: no name at all, and never one made from the account name.
  profile = null;
  expect((await (await list()).json()).author).toEqual({ handle: null, publicProfile: false });
});

test("a save files the draft under the session's account, created or updated in place", async () => {
  rpc.save_guide_draft = { guide_ref: GUIDE, revision: 1, created: true, refusal: null };
  let res = await post({ action: "save", guideId: null, draft: DRAFT });
  expect(res.status).toBe(201);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(await res.json()).toEqual({ guideId: GUIDE, revision: 1, status: "draft" });
  rpc.save_guide_draft = { guide_ref: GUIDE, revision: 3, created: false, refusal: null };
  res = await post({ action: "save", guideId: GUIDE, draft: { ...DRAFT, title: "  Frost leveling, again  " } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ guideId: GUIDE, revision: 3, status: "draft" });
  expect(writes()).toEqual([
    { path: "rpc/save_guide_draft", body: { p_user_id: USER.id, p_guide_id: null, p_payload: DRAFT } },
    { path: "rpc/save_guide_draft", body: { p_user_id: USER.id, p_guide_id: GUIDE, p_payload: { ...DRAFT, title: "Frost leveling, again" } } },
  ]);
  // A draft is work in progress: a draft that would not pass review yet is kept as written.
  rpc.save_guide_draft = { guide_ref: GUIDE, revision: 3, created: false, refusal: null };
  const unfinished = { ...DRAFT, classSlug: null, activity: null, roles: [], levels: null, code: null, order: null, sources: [], body: "", summary: "" };
  expect((await post({ action: "save", guideId: GUIDE, draft: unfinished })).status).toBe(200);
  expect(writes().at(-1)!.body.p_payload).toEqual(unfinished);
});

test("owner, status, review and moderator fields are refused, wherever they are put, and nothing is written", async () => {
  const forged = [
    { userId: OTHER }, { user_id: OTHER }, { owner: OTHER }, { status: "published" }, { reviewed: { by: "Carlos", on: "2026-10-27", build: "1.0.0.1" } },
    { author: "Carlos" }, { moderator: true }, { approvedBy: OTHER }, { history: [] }, { version: 2 }, { revision: 1 },
  ];
  for (const field of forged) {
    const key = Object.keys(field)[0];
    let res = await post({ action: "save", guideId: null, draft: DRAFT, ...field });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(`Unknown field "${key}".`);
    res = await post({ action: "save", guideId: null, draft: { ...DRAFT, ...field } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(`Unknown field "draft.${key}".`);
  }
  for (const body of [null, [], "save", { draft: DRAFT }, { action: "publish", guideId: GUIDE }, { action: "approve", guideId: GUIDE, revision: 1 }]) {
    const res = await post(body);
    expect(res.status).toBe(400);
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("every field keeps its limits and shapes, checked before anything is sent", async () => {
  const source = SOURCES[0];
  const bad: Array<[object, string]> = [
    [{ title: "" }, "Give the guide a title of 1 to 90 characters."],
    [{ title: "x".repeat(91) }, "Give the guide a title of 1 to 90 characters."],
    [{ title: 5 }, "Give the guide a title of 1 to 90 characters."],
    [{ summary: "x".repeat(301) }, "A summary can be up to 300 characters."],
    [{ body: "x".repeat(20_001) }, "The text can be up to 20,000 characters."],
    [{ body: ["## Who it is for"] }, "The text can be up to 20,000 characters."],
    [{ classSlug: "deathknight" }, "Pick a class: warrior, paladin, hunter, rogue, priest, shaman, mage, warlock or druid."],
    [{ activity: "pvp" }, "Pick an activity: leveling, dungeons or raids."],
    [{ roles: ["tank", "tank"] }, "Roles are tank, healer and damage, each at most once."],
    [{ roles: "tank" }, "Roles are tank, healer and damage, each at most once."],
    [{ levels: { from: 0, to: 60 } }, "Levels are whole numbers from 1 to 100."],
    [{ levels: { from: 10, to: 60.5 } }, "Levels are whole numbers from 1 to 100."],
    [{ levels: { from: 10, to: 60, step: 1 } }, "Levels are whole numbers from 1 to 100."],
    [{ code: "EL1-nope" }, "That share code is not valid."],
    [{ code2: "x".repeat(401) }, "The second share code is not valid."],
    [{ order: "O1x-AAAA" }, "That spend order is not valid."],
    [{ code: null, order: PLANNED }, "A spend order needs its share code."],
    [{ order2: PLANNED }, "The second spend order needs the second share code."],
    [{ sources: Array.from({ length: 21 }, () => source) }, "A guide lists at most 20 sources."],
    [{ sources: [{ ...source, url: "http://worldofwarcraft.blizzard.com/en-us/news/1" }] }, SOURCE_SHAPE],
    [{ sources: [{ ...source, url: "javascript:alert(1)" }] }, SOURCE_SHAPE],
    [{ sources: [{ ...source, url: "https://user:secret@news.blizzard.com/en-us/1" }] }, SOURCE_SHAPE],
    [{ sources: [{ ...source, url: "https://news.blizzard.com:8443/en-us/1" }] }, SOURCE_SHAPE],
    [{ sources: [{ ...source, url: `https://news.blizzard.com/${"x".repeat(500)}` }] }, SOURCE_SHAPE],
    [{ sources: [{ ...source, checkedOn: "2026-02-30" }] }, SOURCE_SHAPE],
    [{ sources: [{ ...source, title: "" }] }, SOURCE_SHAPE],
    [{ sources: [{ ...source, note: "extra" }] }, SOURCE_SHAPE],
  ];
  for (const [change, error] of bad) {
    const res = await post({ action: "save", guideId: null, draft: { ...DRAFT, ...change } });
    expect([res.status, (await res.json()).error], JSON.stringify(change).slice(0, 80)).toEqual([400, error]);
  }
  for (const body of [
    { action: "save", guideId: "not-an-id", draft: DRAFT },
    { action: "save", guideId: null },
    { action: "submit", guideId: null, draft: DRAFT, alias: "thrall" },
    { action: "submit", guideId: GUIDE, draft: DRAFT },
    { action: "withdraw", guideId: GUIDE },
    { action: "withdraw", guideId: GUIDE, revision: 0 },
    { action: "withdraw", guideId: GUIDE, revision: "1" },
    { action: "withdraw", guideId: null, revision: 1 },
  ]) expect((await post(body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
  expect(auth.authQuery).not.toHaveBeenCalled();
  // Sent as the server read it: an address as the browser reads it, control characters out and the text trimmed.
  rpc.save_guide_draft = { guide_ref: GUIDE, revision: 1, created: true, refusal: null };
  const res = await post({ action: "save", guideId: null, draft: {
    ...DRAFT, title: "Frost\u0007 leveling", summary: "  Plan  ", body: "Line one\r\nLine\ttwo\u0000",
    sources: [{ title: " Post ", url: "https://NEWS.blizzard.com/en-us/article/1", checkedOn: "2026-10-19" }],
  } });
  expect(res.status).toBe(201);
  expect(writes()[0].body.p_payload).toMatchObject({
    title: "Frost leveling", summary: "Plan", body: "Line one\nLinetwo",
    sources: [{ title: "Post", url: "https://news.blizzard.com/en-us/article/1", checkedOn: "2026-10-19" }],
  });
});

test("the database's refusals of a save come back as what to do next", async () => {
  const cases: Array<[string, number, string]> = [
    ["not_found", 404, "There is no guide of yours with that id."],
    ["guide_limit", 409, "An account can keep 20 guides."],
    ["revision_limit", 409, "A guide can keep 100 revisions."],
    ["daily_limit", 429, "You saved drafts 300 times today. Try again tomorrow."],
  ];
  for (const [refusal, status, error] of cases) {
    rpc.save_guide_draft = { guide_ref: null, revision: null, refusal };
    const res = await post({ action: "save", guideId: GUIDE, draft: DRAFT });
    expect([res.status, await res.json()]).toEqual([status, { error }]);
  }
  rpc.save_guide_draft = { guide_ref: null, revision: null, refusal: "something_new" };
  expect((await post({ action: "save", guideId: GUIDE, draft: DRAFT })).status).toBe(503);
  auth.authQuery.mockRejectedValue(new Error("down"));
  for (const res of [await post({ action: "save", guideId: GUIDE, draft: DRAFT }), await list()]) {
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Guide drafts are unavailable right now. Try again in a minute." });
  }
});

test("submitting needs a handle, and the name the owner saw: never the BattleTag, never a name the profile does not have", async () => {
  profile = { handle: null, public_profile: false };
  let res = await post({ action: "submit", guideId: GUIDE, draft: DRAFT, alias: "thrall" });
  expect([res.status, await res.json()]).toEqual([409, { error: NEEDS_HANDLE, settings: "/settings" }]);
  profile = null;
  res = await post({ action: "submit", guideId: GUIDE, draft: DRAFT, alias: "thrall" });
  expect(res.status).toBe(409);
  profile = { handle: "thrall", public_profile: false };
  for (const alias of ["Thrall#1234", "Thrall", "jaina", "THRALL"]) {
    res = await post({ action: "submit", guideId: GUIDE, draft: DRAFT, alias });
    expect([res.status, await res.json()]).toEqual([409, { error: ALIAS_CHANGED }]);
  }
  expect(writes()).toEqual([]);
});

test("an invalid source, order or plan never reaches the database: the guide check's problems come back instead", async () => {
  const problems = async (draft: object) => {
    const res = await post({ action: "submit", guideId: GUIDE, draft, alias: "thrall" });
    const body = await res.json();
    expect([res.status, body.error]).toEqual([422, NOT_READY]);
    return body.problems as string[];
  };
  const elsewhere = "https://www.example.com/guides/frost";
  expect(await problems({ ...DRAFT, sources: [{ ...SOURCES[0], url: elsewhere }], body: BODY.replace(SOURCE, elsewhere) }))
    .toContainEqual(expect.stringContaining("a guide's sources are Blizzard's own posts"));
  expect(await problems({ ...DRAFT, body: BODY.replace(`[named the class changes](${SOURCE})`, "named the class changes") }))
    .toContainEqual(expect.stringContaining("is not cited in the body"));
  expect(await problems({ ...DRAFT, body: `${BODY}\n\nMore in [another guide](https://www.example.com/x).` }))
    .toContainEqual(expect.stringContaining("https://www.example.com/x is not in sources"));
  expect(await problems({ ...DRAFT, sources: [{ ...SOURCES[0], checkedOn: "2999-01-01" }] })).toContainEqual(expect.stringContaining("after today"));
  expect(await problems({ ...DRAFT, order: PROVISIONAL })).toContainEqual(expect.stringContaining("provisional (O1g)"));
  expect(await problems({ ...DRAFT, order: OUT_OF_ORDER })).toContainEqual(expect.stringContaining("order: "));
  expect(await problems({ ...DRAFT, code: code(RANKS, "warrior") })).toContainEqual(expect.stringContaining("is a warrior plan; this guide is for mage"));
  expect(await problems({ ...DRAFT, levels: { from: 10, to: 12 } })).toContainEqual(expect.stringContaining("needs level 15"));
  expect(await problems({ ...DRAFT, body: BODY.replace("## How to play it", "## Tips") })).toContainEqual(expect.stringContaining("sections must be, in order"));
  expect(await problems({ ...DRAFT, body: "## Who it is for\n\nShort.\n\n## Why this plan\n\nShort.\n\n## How to play it\n\nShort.\n\n## What we do not know yet\n\nShort." }))
    .toContainEqual(expect.stringContaining("at least 150 words"));
  expect(await problems({ ...DRAFT, body: `${BODY}\n\nSee [the calculator](/tools/talents/mage#plan=${CODE}).` })).toContainEqual(expect.stringContaining("carries a talent plan"));
  expect(await problems({ ...DRAFT, classSlug: null, activity: null, roles: [], levels: null, code: null, order: null, summary: "", body: "" })).toEqual([
    "Write a summary.", "Pick a class.", "Pick an activity.", "Pick at least one role.", "Give the levels it covers.", "Add the plan's share code.", "Write the guide's text.",
  ]);
  expect(writes()).toEqual([]);
});

test("no raw HTML, MDX or script: text that is not the guide format is refused at submission, not rendered", async () => {
  const problems = async (draft: object) => {
    const res = await post({ action: "submit", guideId: GUIDE, draft, alias: "thrall" });
    expect(res.status).toBe(422);
    return (await res.json()).problems as string[];
  };
  const HTML = "Raw HTML is not allowed: write plain text. A guide's own marks are **bold**, *emphasis*, [links](/path), {item:N} tokens and [[wiki]] links.";
  for (const text of ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "<iframe src=https://evil.example>", "<!-- note -->", "<MyChart data={x} />"]) {
    expect(await problems({ ...DRAFT, body: `${BODY}\n\n${text}` }), text).toContain(HTML);
  }
  expect(await problems({ ...DRAFT, title: "<b>Frost</b> leveling" })).toContain(HTML);
  expect(await problems({ ...DRAFT, summary: "A plan <em>for</em> mages." })).toContain(HTML);
  expect(await problems({ ...DRAFT, sources: [{ ...SOURCES[0], title: "<a href=x>post</a>" }] })).toContain(HTML);
  // MDX expressions are not tokens.
  expect(await problems({ ...DRAFT, body: `${BODY}\n\n{props.spell} and {spell:133}` }))
    .toContainEqual(expect.stringContaining('"{props.spell}" is not a token'));
  // A link the guide format does not draw is named, not left to look like one.
  for (const link of ["[click](javascript:alert(1))", "[old](http://worldofwarcraft.blizzard.com/x)", "[mail](mailto:a@b.c)", "[data](data:text/html,x)"]) {
    expect(await problems({ ...DRAFT, body: `${BODY}\n\n${link}` }), link)
      .toContainEqual(expect.stringContaining(`"${link}" is not a link a guide can carry`));
  }
  // Angle brackets that are not a tag are words.
  expect(await problems({ ...DRAFT, body: `${BODY}\n\nAt level <40 and >20, use 3 < 5.`, order: PROVISIONAL })).not.toContain(HTML);
  expect(writes()).toEqual([]);
});

test("a valid draft is sent exactly as it was checked, with the name the owner saw, and the database's refusals come back", async () => {
  rpc.submit_guide = { guide_ref: GUIDE, revision: 2, refusal: null };
  let res = await post({ action: "submit", guideId: GUIDE, draft: DRAFT, alias: "thrall" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ guideId: GUIDE, revision: 2, status: "submitted" });
  expect(writes()).toEqual([{ path: "rpc/submit_guide", body: { p_user_id: USER.id, p_guide_id: GUIDE, p_payload: DRAFT, p_alias: "thrall" } }]);
  // A private profile is not made public by submitting: only the guide tables are written.
  expect(calls().filter((c) => !c.path.startsWith("user_profiles?select=") && !c.path.startsWith("rpc/submit_guide"))).toEqual([]);

  const cases: Array<[string, number, object]> = [
    ["not_found", 404, { error: "There is no guide of yours with that id." }],
    ["needs_handle", 409, { error: NEEDS_HANDLE, settings: "/settings" }],
    ["alias_changed", 409, { error: ALIAS_CHANGED }],
    ["already_submitted", 409, { error: "Another revision of this guide is waiting for review. Withdraw it first to submit this one." }],
    ["revision_limit", 409, { error: "A guide can keep 100 revisions." }],
    ["incomplete", 422, { error: "This guide is not ready to submit." }],
    ["submit_limit", 429, { error: "You submitted guides 10 times today. Try again tomorrow." }],
  ];
  for (const [refusal, status, body] of cases) {
    rpc.submit_guide = { guide_ref: null, revision: null, refusal };
    res = await post({ action: "submit", guideId: GUIDE, draft: DRAFT, alias: "thrall" });
    expect([res.status, await res.json()]).toEqual([status, body]);
  }
});

test("a revision waiting for review can be withdrawn by its owner", async () => {
  rpc.withdraw_guide = { guide_ref: GUIDE, revision: 1, refusal: null };
  let res = await post({ action: "withdraw", guideId: GUIDE, revision: 1 });
  expect([res.status, await res.json()]).toEqual([200, { guideId: GUIDE, revision: 1, status: "withdrawn" }]);
  expect(writes()).toEqual([{ path: "rpc/withdraw_guide", body: { p_user_id: USER.id, p_guide_id: GUIDE, p_revision: 1 } }]);
  for (const [refusal, status, error] of [["not_submitted", 409, "That revision is not waiting for review."], ["not_found", 404, "There is no guide of yours with that id."]] as const) {
    rpc.withdraw_guide = { guide_ref: null, revision: null, refusal };
    res = await post({ action: "withdraw", guideId: GUIDE, revision: 1 });
    expect([res.status, await res.json()]).toEqual([status, { error }]);
  }
});

test("nothing a draft names is fetched: no source, image or link is opened to save, check or submit it", async () => {
  const fetch = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  const draft = { ...DRAFT, body: `${BODY}\n\n![map](https://evil.example/track.png) [more](https://evil.example/more)` };
  rpc.save_guide_draft = { guide_ref: GUIDE, revision: 1, created: false, refusal: null };
  expect((await post({ action: "save", guideId: GUIDE, draft })).status).toBe(200);
  expect((await post({ action: "submit", guideId: GUIDE, draft, alias: "thrall" })).status).toBe(422);
  rpc.submit_guide = { guide_ref: GUIDE, revision: 1, refusal: null };
  expect((await post({ action: "submit", guideId: GUIDE, draft: DRAFT, alias: "thrall" })).status).toBe(200);
  expect(fetch).not.toHaveBeenCalled();
});
