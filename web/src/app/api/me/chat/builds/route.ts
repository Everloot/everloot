import { BUILDS_PER_ACCOUNT, SAVES_PER_DAY } from "@/lib/saved-builds";
import { listOwn } from "@/lib/saved-builds-store";
import { parseWorkspaceBuild, SaveUnconfirmed, saveWorkspaceBuild } from "@/lib/chat/workspace-builds";
import { answer, fail, workspaceRead, workspaceWrite } from "@/lib/chat/workspace-store";

/**
 * The player's saved builds, for Chat projects. Opens with EVERLOOT_CHAT_WORKSPACE=1, whatever EVERLOOT_SAVED_BUILDS
 * says. Session only: no API key or MCP reaches it.
 * GET lists the account's builds and character labels, each set's spend order included. POST saves one: without an id
 * a new private build, with one an edit of the account's own build that keeps its sharing as it was. Spend orders are
 * saved with their codes in the same write.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return workspaceRead(req, async (user) => answer(user.id, await listOwn(user.id)));
}

export async function POST(req: Request) {
  return workspaceWrite(req, async (user, body) => {
    const input = parseWorkspaceBuild(body);
    if (!input.ok) return fail(400, input.error);
    let saved;
    try {
      saved = await saveWorkspaceBuild(user.id, input.value);
    } catch (err) {
      // Past save_build_plan the shared "Nothing was saved" may be untrue; say what is known instead.
      if (err instanceof SaveUnconfirmed) return fail(503, "We could not confirm the save. Check your builds before trying again.", "save_unconfirmed");
      throw err;
    }
    if ("refused" in saved) {
      switch (saved.refused) {
        case "not_found": return fail(404, "That build or character is not on this account.", "not_found");
        case "class_mismatch": return fail(400, "That character is another class. Pick a character of the build's class.", "class_mismatch");
        case "build_limit": return fail(409, `You have ${BUILDS_PER_ACCOUNT} saved builds. Delete one to save another.`, "build_limit");
        case "daily_limit": return fail(429, `You saved ${SAVES_PER_DAY} times in the last day. Try again tomorrow.`, "daily_limit");
      }
    }
    return answer(user.id, { build: saved.build }, saved.created ? 201 : 200);
  });
}
