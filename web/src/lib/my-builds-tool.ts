import { GAME_DATA_CREDIT, type McpToolDef } from "@everloot/protocol";
import { z } from "zod";
import type { ExtraTool } from "../../../kb/src/mcp-server";
import { describeBuilds } from "@/components/builds/describe";
import { presentedKey } from "./api-keys";
import { guardOn } from "./data-guard";
import { MY_BUILDS, MY_BUILDS_LINE, MY_BUILDS_REFUSAL, savedBuildsOn, SLUG_PATTERN, type AccountBuilds, type SavedBuild } from "./saved-builds";
import { fail, keyReadsOwn, limitedText, listOwn, NO_STORE, ownBuildsForKey, unavailable } from "./saved-builds-store";
import { getUser, siteUrl } from "./supabase/server";
import { isTalentClass, loadCatalog } from "./talents/catalogs";
import { compareGameBuilds } from "./talents/freshness";
import { nodeMap } from "./talents/rules";
import { decodeBuild, resolveBuild, type ResolvedBuild } from "./talents/share";
import { buildTitle, previewPath, summarizeBuild } from "./talents/summary";
import type { TalentCatalog } from "./talents/types";

/**
 * my_builds: the caller's own saved builds, for Chat and MCP (docs/design/specs/2026-10-20-saved-builds-design.md,
 * step 3). It is not in the protocol's tool table, so the public, keyless tool list never changes. The MCP mounts
 * add it for one request at a time (accountMcpTools); /api/tools/my_builds answers it for the signed-in visitor.
 */
export const MY_BUILDS_TOOL: McpToolDef = {
  title: "My saved builds",
  description: `${MY_BUILDS_LINE} Needs a key made with "Read my saved builds". Each build links its short link while sharing is on, otherwise the calculator, and says whether it was made on an older or a newer game build than the calculator's tree (olderBuild, newerBuild).`,
  inputSchema: { slug: z.string().regex(SLUG_PATTERN).optional().describe("A build's slug from the list, for that build's talents.") },
  annotations: { readOnlyHint: true, openWorldHint: false },
};

const UNAVAILABLE = "Saved builds are unavailable right now. Try again in a minute.";

type Args = { slug?: string };
type Answer = { text: string; structured: object };

/** Where an answer sends a build: its short link while sharing is on, otherwise the calculator with its codes. */
export const buildUrl = (b: SavedBuild, site: string) => b.link ?? `${site}${previewPath(b.classSlug, b.code, b.code2)}`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One talent set put on today's tree: points per tree, the talents taken, and whatever did not load as saved. */
function talentSet(catalog: TalentCatalog, code: string) {
  const decoded = decodeBuild(code);
  const resolved = decoded.ok ? resolveBuild(catalog, decoded.build) : null;
  // Codes are checked when saved; one that no longer reads has no talents to show.
  if (!resolved?.ok) return null;
  const { ranks, unknown, clamped, rejected, buildDiffers } = resolved.build;
  const summary = summarizeBuild(catalog, ranks);
  const nodes = nodeMap(catalog);
  const talents = Object.entries(ranks)
    .map(([id, r]) => ({ node: nodes.get(Number(id))!, r }))
    .sort((a, b) => a.node.treeId - b.node.treeId || a.node.row - b.node.row || a.node.col - b.node.col)
    .map(({ node, r }) => ({
      tree: catalog.trees.find((t) => t.id === node.treeId)?.name ?? String(node.treeId),
      name: (node.kind === "choice" ? node.entries[r.choice ?? 0] : undefined)?.name ?? node.entries[0].name,
      rank: r.rank, maxRanks: node.maxRanks,
    }));
  return { title: buildTitle(catalog, summary), spent: summary.spent, points: summary.trees, talents, unknown, clamped, rejected, buildDiffers };
}

function setNotes(set: Pick<ResolvedBuild, "unknown" | "clamped" | "rejected">): string[] {
  const notes: string[] = [];
  if (set.unknown.length) notes.push(`${plural(set.unknown.length, "talent is", "talents are")} not in today's tree: node ${set.unknown.map((u) => u.id).join(", ")}.`);
  for (const c of set.clamped) {
    notes.push(c.what === "rank" ? `${c.name}: rank ${c.asked} saved, ${c.got} allowed now.` : `${c.name}: the saved choice is gone, so the first is used.`);
  }
  for (const r of set.rejected) notes.push(`${r.name}: ${plural(r.rank, "point", "points")} not placed. ${r.why}`);
  return notes;
}

/** The answer for a build list, or for one build by slug with its talents. */
export async function answerMyBuilds(data: AccountBuilds, args: Args, site = siteUrl()): Promise<Answer> {
  const characters = new Map(data.characters.map((c) => [c.id, c.name]));
  const character = (b: SavedBuild) => (b.characterId && characters.get(b.characterId)) || null;

  if (!args.slug) {
    const facts = await describeBuilds(data.builds);
    const builds = data.builds.map((b) => ({
      slug: b.slug, name: b.name, class: b.classSlug, title: facts.get(b.id)?.title ?? b.classSlug, character: character(b),
      active: b.active, gameBuild: b.gameBuild, olderBuild: facts.get(b.id)?.older ?? false, newerBuild: facts.get(b.id)?.newer ?? false,
      link: b.link, url: buildUrl(b, site),
    }));
    if (builds.length === 0) {
      return { text: `No saved builds yet. Make one in the talent calculator and press Save: ${site}/tools/talents`, structured: { builds } };
    }
    const lines = [`${plural(builds.length, "saved build", "saved builds")}, newest first. Ask again with a slug for a build's talents.`];
    for (const b of builds) {
      lines.push(`- ${b.name} (slug ${b.slug}): ${b.title}${b.character ? `, character ${b.character}` : ""}${b.active ? ", active" : ""}. ` +
        `Game build ${b.gameBuild}${b.olderBuild ? " (older build)" : ""}${b.newerBuild ? " (newer build)" : ""}. ${b.url}`);
    }
    return { text: lines.join("\n"), structured: { builds } };
  }

  const b = data.builds.find((x) => x.slug === args.slug);
  if (!b) return { text: `No saved build with slug ${args.slug} on this account. Ask without a slug for the list.`, structured: { build: null } };
  const catalog = isTalentClass(b.classSlug) ? await loadCatalog(b.classSlug) : null;
  const sets = catalog ? [b.code, b.code2].filter((code): code is string => !!code).map((code) => talentSet(catalog, code)) : [];
  // -1 older than the tree, 1 newer; null when either build cannot be read, and then it is neither.
  const order = catalog ? compareGameBuilds(b.gameBuild, catalog.build) : null;
  const olderBuild = order === -1;
  const newerBuild = order === 1;
  const url = buildUrl(b, site);

  const lines = [
    `${b.name}${character(b) ? `, character ${character(b)}` : ""}${b.active ? ", active" : ""}. ` +
      (olderBuild ? `Made on game build ${b.gameBuild}; the calculator's tree is build ${catalog!.build}, so check each talent.`
        : newerBuild ? `Made on game build ${b.gameBuild}, newer than the calculator's tree (build ${catalog!.build}), which has not caught up with it yet.`
        : `Game build ${b.gameBuild}.`),
  ];
  if (b.notes) lines.push(`Notes: ${b.notes}`);
  sets.forEach((set, i) => {
    if (!set) { lines.push(`Set ${i + 1}: the code no longer reads.`); return; }
    lines.push(`Set ${i + 1}: ${set.title}, ${plural(set.spent, "point", "points")}.`);
    for (const tree of set.points.filter((t) => t.points > 0)) {
      lines.push(`  ${tree.name} ${tree.points}: ${set.talents.filter((t) => t.tree === tree.name).map((t) => `${t.name} ${t.rank}/${t.maxRanks}`).join(", ")}`);
    }
    for (const note of setNotes(set)) lines.push(`  ${note}`);
  });
  lines.push(`Open: ${url}`, GAME_DATA_CREDIT);
  return {
    text: lines.join("\n"),
    structured: {
      build: {
        slug: b.slug, name: b.name, notes: b.notes, class: b.classSlug, character: character(b), active: b.active,
        gameBuild: b.gameBuild, treeBuild: catalog?.build ?? null, olderBuild, newerBuild, link: b.link, url, sets,
      },
    },
  };
}

type Read = { ok: true; value: AccountBuilds } | { ok: false; status: number; error: string; retryAfter?: number };

/**
 * The key owner's builds; the key needs read:own. Counts against the account's hourly allowance unless `count` is
 * false (the request was already counted).
 */
async function readWithKey(token: string, count = true): Promise<Read> {
  const read = await ownBuildsForKey(token, count);
  if (read.ok) return read;
  if (read.refusal === "limited") return { ok: false, status: 429, error: limitedText(read.retryAfter), retryAfter: read.retryAfter };
  return { ok: false, status: read.refusal === "no_scope" ? 403 : 401, error: MY_BUILDS_REFUSAL };
}

/** The account tool, for a request that presented `token` (null: none, so every call is refused). */
function myBuildsMcp(token: string | null): ExtraTool {
  return {
    name: MY_BUILDS,
    def: MY_BUILDS_TOOL,
    handler: async (args) => {
      if (!token) throw new Error(MY_BUILDS_REFUSAL);
      let read: Read;
      // With the data guard on, /mcp/public has already counted this request against the key's allowance.
      try { read = await readWithKey(token, !guardOn()); } catch { throw new Error(UNAVAILABLE); }
      if (!read.ok) throw new Error(read.error);
      return answerMyBuilds(read.value, args as Args);
    },
  };
}

/** What a JSON-RPC body asks for: the tool list, or a call to my_builds. A batch asks what any of its messages asks. */
function asks(body: string): { list: boolean; call: boolean } {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return { list: false, call: false }; }
  const messages = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ method?: unknown; params?: { name?: unknown } } | null>;
  return {
    list: messages.some((m) => m?.method === "tools/list"),
    call: messages.some((m) => m?.method === "tools/call" && m.params?.name === MY_BUILDS),
  };
}

/**
 * The MCP mounts' account tools for one request. With saved builds on, my_builds is listed only for a key that has
 * read:own, and a call to it from anyone else answers with the refusal. Every other request gets nothing extra, so
 * a keyless client sees exactly the public tools.
 */
export async function accountMcpTools(req: Request, body: string): Promise<ExtraTool[]> {
  if (!savedBuildsOn()) return [];
  const { list, call } = asks(body);
  const token = presentedKey(req);
  if (call) return [myBuildsMcp(token)];
  // A failed lookup leaves the tool unlisted; the public tools still answer.
  if (list && token && await keyReadsOwn(token).catch(() => false)) return [myBuildsMcp(token)];
  return [];
}

/** GET /api/tools/my_builds: the website Chat's call, with the visitor's session, or a key with read:own. */
export async function myBuildsRoute(req: Request): Promise<Response> {
  const slug = new URL(req.url).searchParams.get("slug");
  const parsed = z.object(MY_BUILDS_TOOL.inputSchema).safeParse(slug ? { slug } : {});
  if (!parsed.success) return fail(400, "slug is a build's 8-character slug from the list.");
  try {
    const token = presentedKey(req);
    let read: Read;
    if (token) read = await readWithKey(token);
    else {
      const user = await getUser();
      read = user ? { ok: true, value: await listOwn(user.id) } : { ok: false, status: 401, error: MY_BUILDS_REFUSAL };
    }
    if (!read.ok) return fail(read.status, read.error, read.retryAfter ? { "Retry-After": String(read.retryAfter) } : {});
    const answer = await answerMyBuilds(read.value, parsed.data);
    return Response.json({ tool: MY_BUILDS, arguments: parsed.data, answer: answer.structured, text: answer.text }, { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}
