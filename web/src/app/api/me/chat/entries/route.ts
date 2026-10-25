import { decodeCursor, parseEntrySave, uuid } from "@/lib/chat/workspace";
import { answer, fail, listEntries, refused, saveEntry, workspaceRead, workspaceWrite } from "@/lib/chat/workspace-store";

/**
 * The player's saved entries: builds (by id), pages (same-site paths), answers and notes. GET lists them newest
 * first, 50 at a time (?cursor=, ?projectId=). POST saves one with its revision.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return workspaceRead(req, async (user) => {
    const params = new URL(req.url).searchParams;
    const project = params.get("projectId") || null;
    const projectId = project === null ? null : uuid(project);
    if (project !== null && !projectId) return fail(400, "That project id is not valid.");
    const cursor = params.get("cursor") || null;
    const after = cursor === null ? null : decodeCursor(cursor, false);
    if (cursor !== null && !after) return fail(400, "That page cursor is not valid.");
    const { rows, nextCursor } = await listEntries(user.id, { projectId, after });
    return answer(user.id, { entries: rows, nextCursor });
  });
}

export async function POST(req: Request) {
  return workspaceWrite(req, async (user, body) => {
    const input = parseEntrySave(body);
    if (!input.ok) return fail(input.status, input.error);
    const saved = await saveEntry(user.id, input.value);
    return "refused" in saved ? refused(saved.refused) : answer(user.id, { entry: saved.record }, input.value.expectedRevision === 0 ? 201 : 200);
  });
}
