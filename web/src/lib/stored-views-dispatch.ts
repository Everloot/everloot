/**
 * Starts the stored-views job (.github/workflows/stored-views.yml) through GitHub's workflow_dispatch API. The snapshot
 * cron calls it after the heartbeat of a run that added uploads, so the views follow new data within a minute or two.
 * GitHub starts this repository's scheduled runs late or drops them under load; a dispatched run starts at once.
 * The schedule stays as a backstop. EVERLOOT_VIEWS_DISPATCH_TOKEN is a fine-grained token for Everloot/everloot with
 * Actions read and write and nothing else (docs/ENVIRONMENT.md); without it nothing is sent.
 */
export const STORED_VIEWS_DISPATCH_URL = "https://api.github.com/repos/Everloot/everloot/actions/workflows/stored-views.yml/dispatches";

export async function dispatchStoredViews(env: Record<string, string | undefined> = process.env, doFetch: typeof fetch = fetch): Promise<"sent" | "off"> {
  const token = env.EVERLOOT_VIEWS_DISPATCH_TOKEN?.trim();
  if (!token) return "off";
  const res = await doFetch(STORED_VIEWS_DISPATCH_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      // GitHub refuses API requests without a user agent.
      "user-agent": "everloot-cron",
      "content-type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
    signal: AbortSignal.timeout(10_000),
  });
  // 204 is GitHub's only success answer here; the body of a refusal says why and never holds the token.
  if (res.status !== 204) throw new Error(`stored-views dispatch failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return "sent";
}
