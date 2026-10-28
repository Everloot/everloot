/**
 * The few things the server reads from the host it runs on, for Vercel and for the Cloudflare Worker
 * (EVERLOOT_PLATFORM=cloudflare in web/wrangler.jsonc). Everything else in the app is host-neutral.
 */
type Env = Record<string, string | undefined>;

/** True on a host whose edge sets the client address itself, so a header the caller sends cannot stand in for it. */
export function onTrustedEdge(env: Env): boolean {
  return env.VERCEL === "1" || env.EVERLOOT_PLATFORM === "cloudflare";
}

/**
 * The caller's address as the host's edge saw it: x-vercel-forwarded-for on Vercel, cf-connecting-ip on the
 * Worker. Only the current host's header is read, so a caller cannot forge the other one. Null anywhere else.
 */
export function edgeClientIp(req: Request, env: Env): string | null {
  const header = env.VERCEL === "1" ? "x-vercel-forwarded-for" : env.EVERLOOT_PLATFORM === "cloudflare" ? "cf-connecting-ip" : null;
  return (header && req.headers.get(header)?.trim()) || null;
}

/** "production", "preview" or "development" as the host names it; undefined when it names none. */
export function deployEnv(env: Env): string | undefined {
  return env.VERCEL_ENV || env.EVERLOOT_DEPLOY_ENV || undefined;
}

/** The deployed commit as the host names it; undefined when it names none. */
export function deployedCommit(env: Env): string | undefined {
  return env.VERCEL_GIT_COMMIT_SHA || env.EVERLOOT_COMMIT_SHA || undefined;
}
