import { NextResponse } from "next/server";
import { exportWorkspace, NO_STORE, workspaceRead } from "@/lib/chat/workspace-store";

/** GET /api/me/chat/export: the player's whole Chat workspace as a JSON download. Keys and game-file facts are never stored, so never in it. */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return workspaceRead(req, async (user) => {
    const workspace = await exportWorkspace(user.id);
    const now = new Date().toISOString();
    return NextResponse.json({ accountId: user.id, exportedAt: now, ...workspace }, {
      headers: { ...NO_STORE, "Content-Disposition": `attachment; filename="everloot-chat-${now.slice(0, 10)}.json"` },
    });
  });
}
