import { parseDelete, uuid } from "@/lib/chat/workspace";
import { answer, deleteProject, fail, refused, workspaceWrite } from "@/lib/chat/workspace-store";

/** DELETE /api/me/chat/projects/<id>: removes a project. Its chats and saved entries move to Unfiled; builds stay. */
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return workspaceWrite(req, async (user, body) => {
    const id = uuid((await params).id);
    if (!id) return fail(400, "That project id is not valid.");
    const input = parseDelete(body);
    if (!input.ok) return fail(input.status, input.error);
    const refusal = await deleteProject(user.id, id, input.value.expectedRevision);
    return refusal ? refused(refusal) : answer(user.id, { ok: true });
  });
}
