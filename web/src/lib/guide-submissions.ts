import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { stringify } from "yaml";
import { checkGuides, type GuideFile } from "../../../kb/src/guides/check";
import { GUIDE_ACTIVITIES, GUIDE_ROLES, GUIDE_SECTIONS, guideLinkTarget, sitePath, type GuideActivity, type GuideRole } from "../../../kb/src/guides/guide";
import { MARKDOWN_LINK, parsePage, type Block } from "../../../kb/src/wiki/page";
import { zoneTable } from "../../../kb/src/world-coords";
import { readProfile } from "./account-shell";
import { signInPath } from "./auth/return-to";
import { withoutVersionPrefix } from "./build-versions";
import { classLabel } from "./class-context";
import { ACTIVITY_LABEL, ROLE_LABEL, guidesDir, loadGuides, publishedGuide } from "./guides";
import { profilesOn } from "./profiles";
import { ACCOUNT_MISMATCH, EXPECTED_OWNER_HEADER, codeClass, validId } from "./saved-builds";
import { authQuery, getUser, siteUrl, type AccountUser } from "./supabase/server";
import { TALENT_CLASSES, isTalentClass, loadCatalog, type TalentClassSlug } from "./talents/catalogs";
import { loadWiki } from "./wiki";
import { WORLD_MAP } from "./world-map";

/**
 * Community guide drafts (supabase/migrations/20261027140000_guide_submissions.sql): a signed-in player writes a guide
 * in the guides' own format (docs/GUIDES.md), keeps it as a private draft, previews it, and submits a revision for
 * review or withdraws it. Off until EVERLOOT_GUIDE_SUBMISSIONS=1, which needs EVERLOOT_PROFILES=1 too, since a guide
 * names its author by profile handle; with either unset /guides/write and /api/me/guides answer 404.
 *
 * Nothing here publishes. A submitted revision waits for a review that is not built yet, and the public guides are
 * still the reviewed files in kb/guides, read by guides.ts alone. Who reviews is the database's to say: Carlos alone
 * until he names others, as the one row of guide_moderators, which only the operator writes. Nothing in a request, a
 * page or the browser names a reviewer, an owner or a status.
 *
 * The server reads with the service role, always for the session's account, and writes through the migration's
 * functions, which check the owner, the shapes and the limits again and keep each submitted revision as it was sent.
 */
export function guideSubmissionsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.EVERLOOT_GUIDE_SUBMISSIONS === "1" && profilesOn(env);
}

export const WRITE_PATH = "/guides/write";

/** A revision's place in review. How current a published guide still is (current, review due, stale, broken) is not
 *  one: readers work it out from the data, as for the guides in kb/guides. Draft, submitted and withdrawn are reached
 *  here; the rest belong to the review and publication that come later. */
export const GUIDE_STATUSES = ["draft", "submitted", "changes_requested", "approved", "published", "withdrawn", "rejected", "removed", "archived"] as const;
export type GuideStatus = (typeof GUIDE_STATUSES)[number];
export const GUIDE_STATUS_LABEL: Record<GuideStatus, string> = {
  draft: "Draft", submitted: "Waiting for review", changes_requested: "Changes requested", approved: "Approved", published: "Published",
  withdrawn: "Withdrawn", rejected: "Rejected", removed: "Removed", archived: "Archived",
};

export const GUIDES_PER_ACCOUNT = 20;
export const REVISIONS_PER_GUIDE = 100;
export const GUIDE_SAVES_PER_DAY = 300;
export const GUIDE_SUBMISSIONS_PER_DAY = 10;
/** Characters as Postgres counts them; the migration holds the same. The alias is a handle's length. */
export const GUIDE_LIMITS = { title: 90, summary: 300, body: 20_000, sources: 20, sourceTitle: 200, sourceUrl: 500, code: 400, level: 100, alias: 24 } as const;
export type GuideLimits = typeof GUIDE_LIMITS;

export interface GuideSource { title: string; url: string; checkedOn: string }

/** A guide as its writer writes it: the fields of the guides' contract a writer sets, and the text. Who wrote it, who
 *  reviewed it, its status and its versions are not the writer's to set: the account and the review give them. */
export interface GuideDraft {
  title: string;
  summary: string;
  classSlug: TalentClassSlug | null;
  activity: GuideActivity | null;
  roles: GuideRole[];
  levels: { from: number; to: number } | null;
  code: string | null;
  order: string | null;
  code2: string | null;
  order2: string | null;
  sources: GuideSource[];
  body: string;
}

/** The name a guide of the player's carries: their profile handle, or none yet. Never the account name or BattleTag. */
export interface GuideAuthor { handle: string | null; publicProfile: boolean }

export interface GuideRevisionSummary {
  revision: number;
  status: GuideStatus;
  title: string;
  /** The handle the revision was submitted under; null while it is a draft. */
  author: string | null;
  updatedAt: string;
  submittedAt: string | null;
  withdrawnAt: string | null;
}
export interface GuideRevision extends GuideRevisionSummary { draft: GuideDraft }
/** One of the player's guides, its revisions newest first. */
export interface OwnGuide { id: string; revisions: GuideRevisionSummary[] }

export interface GuideOption { value: string; label: string }
export interface GuideEditorOptions { classes: GuideOption[]; activities: GuideOption[]; roles: GuideOption[]; sections: readonly string[] }

/** What the editor offers, in the guide pages' own words. */
export function guideEditorOptions(): GuideEditorOptions {
  return {
    classes: TALENT_CLASSES.map((c) => ({ value: c, label: classLabel(c) })),
    activities: GUIDE_ACTIVITIES.map((a) => ({ value: a, label: ACTIVITY_LABEL[a] })),
    roles: GUIDE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })),
    sections: GUIDE_SECTIONS,
  };
}

/** A new guide: its four sections in order, with nothing under them yet. */
export function emptyDraft(): GuideDraft {
  return {
    title: "", summary: "", classSlug: null, activity: null, roles: [], levels: null, code: null, order: null, code2: null, order2: null,
    sources: [], body: GUIDE_SECTIONS.map((s) => `## ${s}\n\n`).join("\n\n"),
  };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Characters as Postgres counts them, so a limit here is the limit there. */
const length = (s: string) => Array.from(s).length;
/** Plain text: control characters out (line breaks kept in the text, as \n), trimmed. */
const clean = (value: string, multiline = false) =>
  (multiline ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "") : value.replace(/[\u0000-\u001f\u007f]/g, "")).trim();
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const either = (words: readonly string[]) => `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;
const unknownField = (key: string) => `Unknown field "${key}".`;

const DRAFT_KEYS: readonly string[] = ["title", "summary", "classSlug", "activity", "roles", "levels", "code", "order", "code2", "order2", "sources", "body"];
const ORDER_PATTERN = /^O1[pg]-[A-Za-z0-9_-]{1,64}$/;
const DAY = /^[1-9]\d{3}-\d{2}-\d{2}$/;
const SOURCE_SHAPE = "Each source is a title, an https address and the day you checked it (YYYY-MM-DD).";

/** An address as a browser reads it, when it is https with no user name or port, else null. */
function sourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || length(value) > GUIDE_LIMITS.sourceUrl) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  return length(url.href) <= GUIDE_LIMITS.sourceUrl ? url.href : null;
}

/** A day that exists, as YYYY-MM-DD. */
function realDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const at = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value;
}

/** A text field: absent or null is empty; another type is null. */
const textOf = (value: unknown): string | null => (value === undefined || value === null ? "" : typeof value === "string" ? value : null);

function readSources(value: unknown): Parsed<GuideSource[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, error: SOURCE_SHAPE };
  if (value.length > GUIDE_LIMITS.sources) return { ok: false, error: `A guide lists at most ${GUIDE_LIMITS.sources} sources.` };
  const sources: GuideSource[] = [];
  for (const s of value) {
    if (!isObject(s) || Object.keys(s).some((k) => !["title", "url", "checkedOn"].includes(k)) || typeof s.title !== "string") return { ok: false, error: SOURCE_SHAPE };
    const title = clean(s.title);
    const url = sourceUrl(s.url);
    if (!title || length(title) > GUIDE_LIMITS.sourceTitle || url === null || !realDay(s.checkedOn)) return { ok: false, error: SOURCE_SHAPE };
    sources.push({ title, url, checkedOn: s.checkedOn });
  }
  return { ok: true, value: sources };
}

/** A set's share code, null for none; false when it is not one the calculator reads. */
function readCode(value: unknown): string | null | false {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" && codeClass(value.trim()) !== null ? value.trim() : false;
}

/** A set's spend order token, null for none; false when it is not shaped as one. Whether it fits its code, and whether
 *  a player planned it, is the guide check's to say at submission: a draft may hold any order. */
function readOrder(value: unknown): string | null | false {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" && ORDER_PATTERN.test(value.trim()) ? value.trim() : false;
}

/** A draft as the editor sends it. Shapes and limits only: a draft is work in progress, so one that would not pass
 *  review yet is kept as written, and submitting checks the rest. A field the writer does not set is refused. */
export function parseGuideDraft(value: unknown): Parsed<GuideDraft> {
  if (!isObject(value)) return { ok: false, error: "Send the guide's draft." };
  const extra = Object.keys(value).find((k) => !DRAFT_KEYS.includes(k));
  if (extra !== undefined) return { ok: false, error: unknownField(`draft.${extra}`) };

  const rawTitle = textOf(value.title);
  const title = rawTitle === null ? "" : clean(rawTitle);
  if (!title || length(title) > GUIDE_LIMITS.title) return { ok: false, error: `Give the guide a title of 1 to ${GUIDE_LIMITS.title} characters.` };
  const rawSummary = textOf(value.summary);
  const summary = rawSummary === null ? null : clean(rawSummary);
  if (summary === null || length(summary) > GUIDE_LIMITS.summary) return { ok: false, error: `A summary can be up to ${GUIDE_LIMITS.summary} characters.` };
  const rawBody = textOf(value.body);
  const body = rawBody === null ? null : clean(rawBody, true);
  if (body === null || length(body) > GUIDE_LIMITS.body) return { ok: false, error: `The text can be up to ${GUIDE_LIMITS.body.toLocaleString("en-US")} characters.` };

  const classSlug = value.classSlug ?? null;
  if (classSlug !== null && (typeof classSlug !== "string" || !isTalentClass(classSlug))) return { ok: false, error: `Pick a class: ${either(TALENT_CLASSES)}.` };
  const activity = value.activity ?? null;
  if (activity !== null && !GUIDE_ACTIVITIES.includes(activity as GuideActivity)) return { ok: false, error: `Pick an activity: ${either(GUIDE_ACTIVITIES)}.` };
  const roles = value.roles ?? [];
  if (!Array.isArray(roles) || roles.length > GUIDE_ROLES.length || roles.some((r, i) => !GUIDE_ROLES.includes(r) || roles.indexOf(r) !== i)) {
    return { ok: false, error: "Roles are tank, healer and damage, each at most once." };
  }
  const levels = value.levels ?? null;
  const level = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= GUIDE_LIMITS.level;
  if (levels !== null && (!isObject(levels) || Object.keys(levels).some((k) => k !== "from" && k !== "to") || !level(levels.from) || !level(levels.to))) {
    return { ok: false, error: `Levels are whole numbers from 1 to ${GUIDE_LIMITS.level}.` };
  }

  const code = readCode(value.code);
  if (code === false) return { ok: false, error: "That share code is not valid." };
  const code2 = readCode(value.code2);
  if (code2 === false) return { ok: false, error: "The second share code is not valid." };
  const order = readOrder(value.order);
  if (order === false) return { ok: false, error: "That spend order is not valid." };
  if (order !== null && code === null) return { ok: false, error: "A spend order needs its share code." };
  const order2 = readOrder(value.order2);
  if (order2 === false) return { ok: false, error: "The second spend order is not valid." };
  if (order2 !== null && code2 === null) return { ok: false, error: "The second spend order needs the second share code." };

  const sources = readSources(value.sources);
  if (!sources.ok) return sources;
  return {
    ok: true,
    value: {
      title, summary, classSlug: classSlug as TalentClassSlug | null, activity: activity as GuideActivity | null, roles: roles as GuideRole[],
      levels: levels === null ? null : { from: levels.from as number, to: levels.to as number },
      code, order, code2, order2, sources: sources.value, body,
    },
  };
}

export type GuideRequest =
  | { action: "save"; guideId: string | null; draft: GuideDraft }
  | { action: "submit"; guideId: string; draft: GuideDraft; alias: string }
  | { action: "withdraw"; guideId: string; revision: number };

const REQUEST_KEYS: Record<GuideRequest["action"], readonly string[]> = {
  save: ["action", "guideId", "draft"], submit: ["action", "guideId", "draft", "alias"], withdraw: ["action", "guideId", "revision"],
};

/** The body of POST /api/me/guides. Only the session's account owns what it writes: no field names an owner. */
export function parseGuideRequest(body: unknown): Parsed<GuideRequest> {
  if (!isObject(body) || typeof body.action !== "string" || !Object.hasOwn(REQUEST_KEYS, body.action)) {
    return { ok: false, error: "Say what to do with the guide: save, submit or withdraw." };
  }
  const action = body.action as GuideRequest["action"];
  const extra = Object.keys(body).find((k) => !REQUEST_KEYS[action].includes(k));
  if (extra !== undefined) return { ok: false, error: unknownField(extra) };
  const guideId = body.guideId ?? null;
  if (guideId !== null && !validId(guideId)) return { ok: false, error: "That guide id is not valid." };
  if (action === "withdraw") {
    const revision = body.revision;
    if (guideId === null || !Number.isInteger(revision) || (revision as number) < 1 || (revision as number) > REVISIONS_PER_GUIDE) {
      return { ok: false, error: "Say which guide and which revision to withdraw." };
    }
    return { ok: true, value: { action, guideId, revision: revision as number } };
  }
  const draft = parseGuideDraft(body.draft);
  if (!draft.ok) return draft;
  if (action === "save") return { ok: true, value: { action, guideId, draft: draft.value } };
  if (guideId === null) return { ok: false, error: "Save the draft before you submit it." };
  const alias = body.alias;
  if (typeof alias !== "string" || !alias || length(alias) > GUIDE_LIMITS.alias) return { ok: false, error: "Check the name the guide carries, then submit." };
  return { ok: true, value: { action, guideId, draft: draft.value, alias } };
}

// The guide check, as a submission meets it. A submitted revision is a candidate for publication, so it is checked as the
// guide it would be once published, against what the site knows today: the talent tree, the wiki's pages, the guides in
// kb/guides and the committed game data. The review it would then carry is the check's stand-in, never stored or shown.

/** Raw HTML or JSX: a tag, a comment or a processing instruction. Angle brackets around numbers or spaces stay words. */
const TAG = /<[A-Za-z!/?]/;
const HTML = "Raw HTML is not allowed: write plain text. A guide's own marks are **bold**, *emphasis*, [links](/path), {item:N} tokens and [[wiki]] links.";
/** Anything written as a Markdown link, one level of parentheses inside included. The guides draw only MARKDOWN_LINK's
 *  forms, so any other (a script, mail or data address, plain http) would sit in the text looking like a link. */
const LINK_LIKE = /\[[^\]\n]+\]\((?:[^()\s]|\([^()\s]*\))*\)/g;
const DRAWN_LINK = new RegExp(`^${MARKDOWN_LINK.source}$`);
/** The repository's private path check is for its own files; a player's words are not one. */
const NO_PRIVATE_PATHS = /(?!)/;
const COMMUNITY_FILE = "community/community-draft.md";

/** The ids the committed game data knows, for {item:N} and {zone:N}: loaded on the first check, then kept. */
let known: { items: Set<number>; zones: Set<number> } | null = null;
async function knownData() {
  if (!known) {
    const { CLIENT_LAYER } = await import("../../../kb/src/client-layer-file");
    known = { items: new Set(CLIENT_LAYER.items.map(([id]) => id)), zones: new Set(zoneTable(WORLD_MAP).map((z) => z.mapId)) };
  }
  return known;
}

/** The guides in kb/guides as files, so a draft's link to one reads as the guide check reads it. */
function seedGuideFiles(dir = guidesDir()): GuideFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort()
    .map((f) => ({ path: `guides/${f}`, source: readFileSync(join(dir, f), "utf8") }));
}

/** The draft as a guide file that has been published once: the check's own format, read by the check's own parser. */
function draftFile(draft: GuideDraft, author: string, today: string, build: string): { file: GuideFile; bodyLine: number } {
  const review = { by: author, on: today, build };
  const fm = {
    id: 2_147_483_647, slug: "community-draft", version: 1, status: "published", title: draft.title, summary: draft.summary,
    classSlug: draft.classSlug, activity: draft.activity, roles: draft.roles, levels: draft.levels, code: draft.code,
    ...(draft.order === null ? {} : { order: draft.order }), ...(draft.code2 === null ? {} : { code2: draft.code2 }),
    ...(draft.order2 === null ? {} : { order2: draft.order2 }),
    author, reviewed: review, sources: draft.sources, history: [{ version: 1, ...review, note: "Submitted for review." }],
  };
  const head = `---\n${stringify(fm)}---\n`;
  return { file: { path: COMMUNITY_FILE, source: `${head}${draft.body}\n` }, bodyLine: head.split("\n").length };
}

/** What must change before the draft can be submitted, one sentence each; empty when nothing must. */
export async function submissionProblems(draft: GuideDraft, author: GuideAuthor, today = new Date().toISOString().slice(0, 10)): Promise<string[]> {
  const problems: string[] = [];
  if ([draft.title, draft.summary, draft.body, ...draft.sources.map((s) => s.title)].some((t) => TAG.test(t))) problems.push(HTML);
  for (const [link] of draft.body.matchAll(LINK_LIKE)) {
    if (!DRAWN_LINK.test(link)) problems.push(`"${link}" is not a link a guide can carry: write [words](https://…) for a source or [words](/path) for a page on this site.`);
  }
  const missing = [
    !draft.summary && "Write a summary.", draft.classSlug === null && "Pick a class.", draft.activity === null && "Pick an activity.",
    draft.roles.length === 0 && "Pick at least one role.", draft.levels === null && "Give the levels it covers.",
    draft.code === null && "Add the plan's share code.", !/\S/.test(draft.body) && "Write the guide's text.",
  ].filter((m): m is string => m !== false);
  if (missing.length || draft.classSlug === null) return [...problems, ...missing];

  const [catalog, data] = await Promise.all([loadCatalog(draft.classSlug), knownData()]);
  const wiki = loadWiki();
  const { file, bodyLine } = draftFile(draft, author.handle ?? "author", today, catalog.build);
  const checked = checkGuides([file, ...seedGuideFiles()], {
    catalogs: new Map([[draft.classSlug, catalog]]),
    wikiPages: new Map([...wiki.pages].map(([slug, page]) => [slug, page.status])),
    known: data,
    privatePaths: NO_PRIVATE_PATHS,
    today,
  });
  return [
    ...problems,
    ...checked.problems.filter((p) => p.file === file.path)
      .map((p) => (p.line !== undefined && p.line >= bodyLine ? `Line ${p.line - bodyLine + 1} of the text: ${p.message}` : p.message)),
  ];
}

/** The draft's text as blocks, read as the guide pages read a guide's body. */
export const draftBlocks = (body: string): Block[] => parsePage(`---\n{}\n---\n${body}`).blocks;

/** Whether a draft's preview draws a link: a page of this site (another guide only while it is published) or one of the
 *  draft's own sources. Any other address stands as its words: another site, a script, a path that leaves the site. */
export function previewLinkable(href: string, sources: GuideSource[]): boolean {
  const path = sitePath(href);
  if (path === null) return sources.some((s) => s.url === href);
  const guide = guideLinkTarget(withoutVersionPrefix(path));
  return guide === null || publishedGuide(loadGuides(), guide) !== null;
}

// Storage. Reads are the service role's, always for one account; writes go through the migration's functions.

const SUMMARY_COLUMNS = "guide_id,revision,status,title,author_handle,updated_at,submitted_at,withdrawn_at";
const REVISION_COLUMNS = `${SUMMARY_COLUMNS},summary,class_slug,activity,roles,level_from,level_to,code,point_order,code2,point_order2,sources,body`;

interface SummaryRow {
  guide_id: string; revision: number; status: GuideStatus; title: string; author_handle: string | null;
  updated_at: string; submitted_at: string | null; withdrawn_at: string | null;
}
interface RevisionRow extends SummaryRow {
  summary: string; class_slug: TalentClassSlug | null; activity: GuideActivity | null; roles: GuideRole[];
  level_from: number | null; level_to: number | null; code: string | null; point_order: string | null;
  code2: string | null; point_order2: string | null; sources: GuideSource[]; body: string;
}

const iso = (at: string) => new Date(at).toISOString();
const toSummary = (r: SummaryRow): GuideRevisionSummary => ({
  revision: r.revision, status: r.status, title: r.title, author: r.author_handle, updatedAt: iso(r.updated_at),
  submittedAt: r.submitted_at === null ? null : iso(r.submitted_at), withdrawnAt: r.withdrawn_at === null ? null : iso(r.withdrawn_at),
});

/** The account's guides, the most recently changed first, each with its revisions newest first. No text. */
export async function listOwnGuides(userId: string): Promise<OwnGuide[]> {
  const rows = await authQuery<SummaryRow[]>(
    `guide_submission_revisions?select=${SUMMARY_COLUMNS}&user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc,revision.desc`,
  );
  const guides = new Map<string, OwnGuide>();
  for (const r of rows) {
    if (!guides.has(r.guide_id)) guides.set(r.guide_id, { id: r.guide_id, revisions: [] });
    guides.get(r.guide_id)!.revisions.push(toSummary(r));
  }
  for (const g of guides.values()) g.revisions.sort((a, b) => b.revision - a.revision);
  return [...guides.values()];
}

/** The newest revision of one of the account's guides, with its words: its draft, or the last revision sent. */
export async function newestRevision(userId: string, guideId: string): Promise<GuideRevision | null> {
  const [r] = await authQuery<RevisionRow[]>(
    `guide_submission_revisions?select=${REVISION_COLUMNS}&user_id=eq.${encodeURIComponent(userId)}&guide_id=eq.${encodeURIComponent(guideId)}&order=revision.desc&limit=1`,
  );
  if (!r) return null;
  return {
    ...toSummary(r),
    draft: {
      title: r.title, summary: r.summary, classSlug: r.class_slug, activity: r.activity, roles: r.roles,
      levels: r.level_from === null || r.level_to === null ? null : { from: r.level_from, to: r.level_to },
      code: r.code, order: r.point_order, code2: r.code2, order2: r.point_order2, sources: r.sources, body: r.body,
    },
  };
}

export async function guideAuthor(userId: string): Promise<GuideAuthor> {
  const row = await readProfile(userId);
  return { handle: row?.handle ?? null, publicProfile: row?.public_profile ?? false };
}

export type GuideRefusal =
  | "not_found" | "guide_limit" | "revision_limit" | "daily_limit" | "needs_handle" | "alias_changed" | "already_submitted"
  | "incomplete" | "submit_limit" | "not_submitted";
type Written = { guide_ref: string | null; revision: number | null; created?: boolean; refusal: string | null } | null;
type Outcome = { guideId: string; revision: number; created: boolean } | { refused: GuideRefusal };

/** A function's answer: what it wrote, or one of the refusals it gives. Anything else, an unknown refusal too, fails. */
function outcome(row: Written, refusals: readonly GuideRefusal[]): Outcome {
  if (row && row.guide_ref === null && refusals.includes(row.refusal as GuideRefusal)) return { refused: row.refusal as GuideRefusal };
  if (!row || typeof row.guide_ref !== "string" || !Number.isInteger(row.revision) || row.refusal !== null) throw new Error("Guide was not saved");
  return { guideId: row.guide_ref, revision: row.revision as number, created: row.created === true };
}
const rpc = (name: string, args: object) => authQuery<Written>(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });

/** Creates (no guideId) or edits the account's draft of a guide; a guide whose last revision was sent gets its next. */
export async function saveGuideDraft(userId: string, guideId: string | null, draft: GuideDraft): Promise<Outcome> {
  return outcome(await rpc("save_guide_draft", { p_user_id: userId, p_guide_id: guideId, p_payload: draft }),
    ["not_found", "guide_limit", "revision_limit", "daily_limit"]);
}

/** Sends the draft, exactly as the server checked it, for review under the handle the player saw (alias). */
export async function submitGuide(userId: string, guideId: string, draft: GuideDraft, alias: string): Promise<Outcome> {
  return outcome(await rpc("submit_guide", { p_user_id: userId, p_guide_id: guideId, p_payload: draft, p_alias: alias }),
    ["not_found", "needs_handle", "alias_changed", "already_submitted", "incomplete", "revision_limit", "submit_limit"]);
}

export async function withdrawGuide(userId: string, guideId: string, revision: number): Promise<Outcome> {
  return outcome(await rpc("withdraw_guide", { p_user_id: userId, p_guide_id: guideId, p_revision: revision }), ["not_found", "not_submitted"]);
}

// The route under /api/me/guides. Same-origin JSON for the signed-in player; nothing is cached.

export const NO_STORE = { "Cache-Control": "private, no-store" };
export const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });
export const unavailable = () => fail(503, "Guide drafts are unavailable right now. Try again in a minute.");

/**
 * 404 with the switch off, 403 for a write not from this site (a missing Origin too), 401 with where to sign in, 409
 * when the request names another account than the session's (EXPECTED_OWNER_HEADER, as saved builds do), else the user.
 */
export async function guideAccount(req: Request, write: boolean): Promise<AccountUser | Response> {
  if (!guideSubmissionsOn()) return fail(404, "Not found");
  if (write && req.headers.get("origin") !== siteUrl()) return fail(403, "Invalid origin");
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in to write guides.", signIn: signInPath(WRITE_PATH) }, { status: 401, headers: NO_STORE });
  const expected = req.headers.get(EXPECTED_OWNER_HEADER);
  if (expected !== null && expected !== user.id) {
    return NextResponse.json({ error: "This was meant for another account than the one signed in now. Nothing was saved.", code: ACCOUNT_MISMATCH },
      { status: 409, headers: NO_STORE });
  }
  return user;
}
