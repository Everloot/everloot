import { parseDelete, uuid } from "@/lib/chat/workspace";
import { answer, deleteConversation, fail, getConversation, refused, workspaceRead, workspaceWrite } from "@/lib/chat/workspace-store";

/** GET /api/me/chat/conversations/<id>: one of the player's chats with its messages. DELETE removes it. */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return workspaceRead(req, async (user) => {
    const id = uuid((await params).id);
    if (!id) return fail(400, "That chat id is not valid.");
    const conversation = await getConversation(user.id, id);
    return conversation ? answer(user.id, { conversation }) : refused("not_found");
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return workspaceWrite(req, async (user, body) => {
    const id = uuid((await params).id);
    if (!id) return fail(400, "That chat id is not valid.");
    const input = parseDelete(body);
    if (!input.ok) return fail(input.status, input.error);
    const refusal = await deleteConversation(user.id, id, input.value.expectedRevision);
    return refusal ? refused(refusal) : answer(user.id, { ok: true });
  });
}
