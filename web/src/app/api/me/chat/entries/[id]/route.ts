import { parseDelete, uuid } from "@/lib/chat/workspace";
import { answer, deleteEntry, fail, refused, workspaceWrite } from "@/lib/chat/workspace-store";

/** DELETE /api/me/chat/entries/<id>: removes one saved entry. A saved build it pointed to stays. */
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return workspaceWrite(req, async (user, body) => {
    const id = uuid((await params).id);
    if (!id) return fail(400, "That entry id is not valid.");
    const input = parseDelete(body);
    if (!input.ok) return fail(input.status, input.error);
    const refusal = await deleteEntry(user.id, id, input.value.expectedRevision);
    return refusal ? refused(refusal) : answer(user.id, { ok: true });
  });
}
