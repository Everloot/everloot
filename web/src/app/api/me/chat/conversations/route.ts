import { decodeCursor, parseConversationSave, uuid } from "@/lib/chat/workspace";
import { answer, fail, listConversations, refused, saveConversation, workspaceRead, workspaceWrite } from "@/lib/chat/workspace-store";
import { WORKSPACE_LIMITS } from "@/lib/chat/workspace-types";

/**
 * The player's private chats. GET lists them without messages, pinned first then newest, 50 at a time
 * (?cursor= from the last page, ?query= in the title, ?projectId=). POST saves one whole chat with its revision.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return workspaceRead(req, async (user) => {
    const params = new URL(req.url).searchParams;
    const project = params.get("projectId") || null;
    const projectId = project === null ? null : uuid(project);
    if (project !== null && !projectId) return fail(400, "That project id is not valid.");
    const query = (params.get("query") ?? "").trim();
    if (query.length > WORKSPACE_LIMITS.title) return fail(400, "Search for at most 100 characters.");
    const cursor = params.get("cursor") || null;
    const after = cursor === null ? null : decodeCursor(cursor, true);
    if (cursor !== null && !after) return fail(400, "That page cursor is not valid.");
    const { rows, nextCursor } = await listConversations(user.id, { projectId, query: query || null, after });
    return answer(user.id, { conversations: rows, nextCursor });
  });
}

export async function POST(req: Request) {
  return workspaceWrite(req, async (user, body) => {
    const input = parseConversationSave(body);
    if (!input.ok) return fail(input.status, input.error);
    const saved = await saveConversation(user.id, input.value);
    return "refused" in saved ? refused(saved.refused) : answer(user.id, { conversation: saved.record }, input.value.expectedRevision === 0 ? 201 : 200);
  });
}
