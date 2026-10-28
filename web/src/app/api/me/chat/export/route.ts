import { decodeCursor, encodeCursor, uuid } from "@/lib/chat/workspace";
import { answer, fail, getConversation, listConversations, listEntries, listProjects, workspaceRead } from "@/lib/chat/workspace-store";
import { WORKSPACE_LIMITS } from "@/lib/chat/workspace-types";
import { listOwn } from "@/lib/saved-builds-store";

/**
 * GET /api/me/chat/export?section=: the player's Chat workspace one bounded page at a time, which the browser joins
 * into one download (exportWorkspace in workspace-api.ts). A whole account is up to 10 MiB, past the 4.5 MB a
 * function may answer, so no page holds it all: projects in one page, one whole chat per page, entries up to
 * ENTRY_BYTES per page, and the owner's builds that entries name (?ids=, up to 50). Keys and game-file facts are
 * never stored, so never in it.
 */
export const dynamic = "force-dynamic";

/** Entry bytes per page, well under the response limit. One entry is at most about 200 KB, so a page always holds one. */
const ENTRY_BYTES = 3 * 1024 * 1024;

export async function GET(req: Request) {
  return workspaceRead(req, async (user) => {
    const params = new URL(req.url).searchParams;
    const cursor = params.get("cursor") || null;
    const badCursor = () => fail(400, "That page cursor is not valid.");
    switch (params.get("section")) {
      case "projects":
        return answer(user.id, { projects: await listProjects(user.id), nextCursor: null });
      case "conversations": {
        const after = cursor === null ? null : decodeCursor(cursor, true);
        if (cursor !== null && !after) return badCursor();
        const { rows } = await listConversations(user.id, { projectId: null, query: null, after });
        const next = rows[0];
        if (!next) return answer(user.id, { conversations: [], nextCursor: null });
        // A chat deleted since the list was read is skipped; the cursor still moves past it.
        const conversation = await getConversation(user.id, next.id);
        return answer(user.id, {
          conversations: conversation ? [conversation] : [],
          nextCursor: rows.length > 1 ? encodeCursor([next.pinned, next.updatedAt, next.id]) : null,
        });
      }
      case "entries": {
        const after = cursor === null ? null : decodeCursor(cursor, false);
        if (cursor !== null && !after) return badCursor();
        const { rows, nextCursor } = await listEntries(user.id, { projectId: null, after });
        let bytes = 0;
        let keep = 0;
        for (const row of rows) {
          bytes += Buffer.byteLength(JSON.stringify(row));
          if (keep > 0 && bytes > ENTRY_BYTES) break;
          keep++;
        }
        const last = rows[keep - 1];
        return answer(user.id, {
          entries: rows.slice(0, keep),
          nextCursor: keep < rows.length ? encodeCursor([last.updatedAt, last.id]) : nextCursor,
        });
      }
      case "builds": {
        const raw = (params.get("ids") ?? "").split(",").filter(Boolean);
        const ids = new Set(raw.map(uuid));
        if (!raw.length || raw.length > WORKSPACE_LIMITS.page || ids.has(null)) return fail(400, "Name up to 50 build ids.");
        // The build itself, as its owner made it: not its short link, sharing or character.
        const builds = (await listOwn(user.id)).builds.filter((b) => ids.has(b.id)).map((b) => ({
          id: b.id, name: b.name, notes: b.notes, classSlug: b.classSlug, code: b.code, code2: b.code2, gameBuild: b.gameBuild, updatedAt: b.updatedAt,
        }));
        return answer(user.id, { builds, nextCursor: null });
      }
      default:
        return fail(400, "Say which part of the export to read: projects, conversations, entries or builds.");
    }
  });
}
