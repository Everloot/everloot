import { answer, clearWorkspace, workspaceWrite } from "@/lib/chat/workspace-store";

/** DELETE /api/me/chat/workspace: clears the player's Chat projects, chats and saved entries. The account and its builds stay. */
export const dynamic = "force-dynamic";

export async function DELETE(req: Request) {
  return workspaceWrite(req, async (user) => {
    await clearWorkspace(user.id);
    return answer(user.id, { ok: true });
  });
}
