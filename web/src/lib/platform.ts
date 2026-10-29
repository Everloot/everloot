/**
 * The few things the server reads from the host it runs on, the Cloudflare Worker (EVERLOOT_PLATFORM=cloudflare in
 * web/wrangler.jsonc). Everything else in the app is host-neutral.
 */
type Env = Record<string, string | undefined>;

/** True on a host whose edge sets the client address itself, so a header the caller sends cannot stand in for it. */
export function onTrustedEdge(env: Env): boolean {
  return env.EVERLOOT_PLATFORM === "cloudflare";
}

/** The caller's address as Cloudflare's edge saw it (cf-connecting-ip) on the Worker. Null anywhere else. */
export function edgeClientIp(req: Request, env: Env): string | null {
  if (!onTrustedEdge(env)) return null;
  return req.headers.get("cf-connecting-ip")?.trim() || null;
}

/** "production", "preview" or "development" as the host names it; undefined when it names none. */
export function deployEnv(env: Env): string | undefined {
  return env.EVERLOOT_DEPLOY_ENV || undefined;
}

/** The deployed commit as the host names it; undefined when it names none. */
export function deployedCommit(env: Env): string | undefined {
  return env.EVERLOOT_COMMIT_SHA || undefined;
}
