import { parseImport } from "@/lib/chat/workspace";
import { answer, fail, importConversation, refused, workspaceWrite } from "@/lib/chat/workspace-store";

/**
 * POST /api/me/chat/import: copies one browser chat into the account, when the player asks. The same account,
 * browser (sourceId) and local id always answer with the same conversation, so a retry never duplicates it.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return workspaceWrite(req, async (user, body) => {
    const input = parseImport(body);
    if (!input.ok) return fail(input.status, input.error);
    const saved = await importConversation(user.id, input.value);
    return "refused" in saved ? refused(saved.refused) : answer(user.id, { conversation: saved.record, created: saved.created }, saved.created ? 201 : 200);
  });
}
