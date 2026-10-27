import { authPool, pgRateLimitStore } from "@/lib/auth/db";
import { createFreeChat } from "@/lib/chat/free-chat";

/**
 * POST /api/chat/free/chat/completions: Everloot (free), /chat's built-in model for visitors with no key, as an
 * OpenAI-compatible endpoint the page's own loop calls. Off (404) until a free provider's env is set
 * (EVERLOOT_FREE_CHAT_KEY, EVERLOOT_FREE_CHAT_CF_*); see web/src/lib/chat/free-chat.ts. The limits count in
 * public.auth_rate_limit, the sign-in limits' table.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const freeChat = createFreeChat({ store: () => pgRateLimitStore(authPool()) });

export function POST(req: Request): Promise<Response> {
  return freeChat.POST(req);
}
