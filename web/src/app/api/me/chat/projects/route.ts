import { parseProjectSave } from "@/lib/chat/workspace";
import { answer, fail, listProjects, refused, saveProject, workspaceRead, workspaceWrite } from "@/lib/chat/workspace-store";

/**
 * The player's private Chat projects (docs/superpowers/specs/2026-10-25-chat-projects-design.md). Nothing works
 * until EVERLOOT_CHAT_WORKSPACE=1. Session only: no API key or MCP reaches it.
 * GET lists every project. POST saves one: expectedRevision 0 makes it, otherwise it must be the last revision seen.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return workspaceRead(req, async (user) => answer(user.id, { projects: await listProjects(user.id) }));
}

export async function POST(req: Request) {
  return workspaceWrite(req, async (user, body) => {
    const input = parseProjectSave(body);
    if (!input.ok) return fail(input.status, input.error);
    const saved = await saveProject(user.id, input.value);
    return "refused" in saved ? refused(saved.refused) : answer(user.id, { project: saved.record }, input.value.expectedRevision === 0 ? 201 : 200);
  });
}
