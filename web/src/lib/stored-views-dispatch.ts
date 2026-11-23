import { tokenExpiry, writeDispatchRecord, type DispatchRecord } from "./stored-views-status";

/**
 * Starts the stored-views job (.github/workflows/stored-views.yml) through GitHub's workflow_dispatch API. The snapshot
 * cron calls it after the heartbeat of a run that added uploads, so the views follow new data within a minute or two.
 * GitHub starts this repository's scheduled runs late or drops them under load; a dispatched run starts at once.
 * The schedule stays as a backstop. EVERLOOT_VIEWS_DISPATCH_TOKEN is a fine-grained token for Everloot/everloot with
 * Actions read and write and nothing else (docs/ENVIRONMENT.md); without it nothing is sent.
 * Each answer is recorded (lib/stored-views-status.ts) with the token's expiry, which GitHub sends on every answer,
 * so /api/health and the site-health check can warn before the token runs out. A failed record never fails the start.
 */
export const STORED_VIEWS_DISPATCH_URL = "https://api.github.com/repos/Everloot/everloot/actions/workflows/stored-views.yml/dispatches";
/**
 * The site-health check (.github/workflows/site-health.yml). Its own 15-minute schedule ran 4 times in the 24 hours to
 * 2026-11-23 03:40 UTC, as GitHub throttles this repository's schedules, so the snapshot cron also starts it once an
 * hour with the same token. The schedule stays: it still runs when the cron Worker itself has stopped.
 */
export const SITE_HEALTH_DISPATCH_URL = "https://api.github.com/repos/Everloot/everloot/actions/workflows/site-health.yml/dispatches";

export async function dispatchStoredViews(
  env: Record<string, string | undefined> = process.env,
  doFetch: typeof fetch = fetch,
  record: (r: DispatchRecord) => Promise<void> = writeDispatchRecord,
): Promise<"sent" | "off"> {
  return dispatchWorkflow(STORED_VIEWS_DISPATCH_URL, env, doFetch, record);
}

/** Starts the site-health check. Nothing is recorded: the stored-views start's record is what /api/health reports. */
export async function dispatchSiteHealth(env: Record<string, string | undefined> = process.env, doFetch: typeof fetch = fetch): Promise<"sent" | "off"> {
  return dispatchWorkflow(SITE_HEALTH_DISPATCH_URL, env, doFetch);
}

async function dispatchWorkflow(
  url: string,
  env: Record<string, string | undefined>,
  doFetch: typeof fetch,
  record?: (r: DispatchRecord) => Promise<void>,
): Promise<"sent" | "off"> {
  const token = env.EVERLOOT_VIEWS_DISPATCH_TOKEN?.trim();
  if (!token) return "off";
  const res = await doFetch(url, {
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
  const workflow = url.split("/workflows/")[1]?.split("/")[0] ?? url;
  if (record) {
    try {
      await record({
        at: new Date().toISOString(), httpStatus: res.status, sent: res.status === 204,
        tokenExpiresAt: tokenExpiry(res.headers.get("github-authentication-token-expiration")),
      });
    } catch (err) {
      console.error(`${workflow} dispatch record failed`, err);
    }
  }
  // 204 is GitHub's only success answer here; the body of a refusal says why and never holds the token.
  if (res.status !== 204) {
    const name = workflow === "stored-views.yml" ? "stored-views" : workflow;
    throw new Error(`${name} dispatch failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
  return "sent";
}
