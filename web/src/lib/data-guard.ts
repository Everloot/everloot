import { CREDIT_LINE, LICENCE, LICENCE_URL, SITE, TERMS_URL } from "@everloot/protocol";
import { consumeKey, presentedKey, type KeySurface } from "./api-keys";
import { intakeQuota } from "./intake-quota";

/**
 * Who may read how much from the machine-readable endpoints, and the credit every answer carries.
 *
 * Off (the default): the endpoints behave as before; only the attribution is added.
 * EVERLOOT_DATA_GUARD=1 (set after 20261019120000_data_guard.sql is applied):
 * - the bulk endpoints, the corpus feed and the drop list, allow ANON_PER_HOUR requests per IP address
 *   per hour and return at most ANON_PAGE records a page, with a `next` link;
 * - a free key (Authorization: Bearer evl_…) allows KEY_PER_HOUR requests per hour per account, across
 *   all its keys and every endpoint, and KEY_PAGE records a page; every keyed request is counted per key;
 * - the per-question endpoints (public MCP and /api/tools, market prices) keep their existing per-IP limits.
 */
export const ANON_PER_HOUR = 30;
export const ANON_PAGE = 500;
export const KEY_PER_HOUR = 2000;
export const KEY_PAGE = 5000;
export const KEY_URL = `${SITE}/docs/api/keys`;

export type Surface = KeySurface;
export interface Admitted { tier: "open" | "anonymous" | "key"; pageMax: number | null; keyId?: string }

const NO_STORE = { "Cache-Control": "no-store" };

export function guardOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.EVERLOOT_DATA_GUARD === "1";
}

/** Response headers that carry the licence and credit line, for clients that never read the body. */
export function attributionHeaders(): Record<string, string> {
  return {
    Link: `<${LICENCE_URL}>; rel="license", <${TERMS_URL}>; rel="terms-of-service"`,
    "X-Everloot-Licence": LICENCE,
    "X-Everloot-Credit": CREDIT_LINE,
  };
}

/** The same, as a JSON field. `source` is the page a person can open to see the data. */
export function attribution(sourcePath: string) {
  return { licence: LICENCE, licenceUrl: LICENCE_URL, credit: CREDIT_LINE, source: `${SITE}${sourcePath}`, terms: TERMS_URL };
}

/** `getAKey` is sent only while keys exist (the guard is on); before that it would point at nothing. */
function refused(status: number, error: string, on: boolean, extra: Record<string, string> = {}): Response {
  return Response.json({ ok: false, error, ...(on ? { getAKey: KEY_URL } : {}) }, { status, headers: { ...NO_STORE, ...extra } });
}

function limited(retryAfter: number, error: string, on: boolean): Response {
  return refused(429, error, on, { "retry-after": String(retryAfter) });
}

const KEY_HOWTO = `get a free key at ${KEY_URL} and send it as "Authorization: Bearer <key>"`;

/**
 * Admit one request to a machine-readable endpoint, or answer it with 401, 429 or 503. A quota outage
 * fails closed, as the existing endpoints do. `anonymousAs` counts a keyless caller as another surface
 * while the guard is on (/api/tools answers the MCP's questions, so it spends the MCP's quota); a key is
 * still counted under `surface`.
 */
export async function admit(
  req: Request, surface: Surface,
  deps: { env?: Record<string, string | undefined>; fetch?: typeof fetch; quota?: Pick<typeof intakeQuota, "api" | "mcp" | "market">; anonymousAs?: "mcp" } = {},
): Promise<Admitted | Response> {
  const env = deps.env ?? process.env;
  const quota = deps.quota ?? intakeQuota;
  const on = guardOn(env);
  const anonymous = on && deps.anonymousAs ? deps.anonymousAs : surface;
  try {
    const token = on ? presentedKey(req) : null;
    if (token) {
      const result = await consumeKey(token, surface, env, deps.fetch ?? fetch);
      if (!result.keyId) {
        return refused(401, `This API key is not valid or was revoked. Make a new one at ${KEY_URL}.`, on,
          { "WWW-Authenticate": 'Bearer error="invalid_token", error_description="The key is unknown, revoked or expired"' });
      }
      if (!result.allowed) {
        return limited(result.retryAfter, `This account's keys have used their ${KEY_PER_HOUR} requests for this hour. Try again in ${result.retryAfter} seconds, or write to hello@everloot.app if you need more.`, on);
      }
      return { tier: "key", pageMax: KEY_PAGE, keyId: result.keyId };
    }
    if (anonymous === "mcp" || anonymous === "market") {
      const result = anonymous === "mcp" ? await quota.mcp(req) : await quota.market(req);
      if (!result.allowed) {
        return limited(result.retryAfter, `Too many requests from this address. Try again in ${result.retryAfter} seconds${on ? `, or ${KEY_HOWTO}` : ""}.`, on);
      }
      return { tier: on ? "anonymous" : "open", pageMax: null };
    }
    if (!on) return { tier: "open", pageMax: null };
    const result = await quota.api(req);
    if (!result.allowed) {
      return limited(result.retryAfter,
        `Without a key this endpoint answers ${ANON_PER_HOUR} requests per hour per address. Try again in ${result.retryAfter} seconds, or ${KEY_HOWTO}.`, on);
    }
    return { tier: "anonymous", pageMax: ANON_PAGE };
  } catch {
    return refused(503, "Rate limit storage unavailable. Try again later.", on);
  }
}

export interface Page { offset: number; limit: number; total: number; next: string | null }

function intParam(params: URLSearchParams, name: string, min: number): number | undefined | null {
  const raw = params.get(name);
  if (raw === null) return undefined;
  if (!/^\d{1,9}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= min ? value : null;
}

/**
 * `?offset=` and `?limit=` over a list. `limit` is capped at the caller's page size; with no page size
 * (guard off) and no `limit`, the whole list is one page, as before. Null means a bad parameter (400).
 */
export function pageRequest(req: Request, pageMax: number | null): { offset: number; limit: number | null } | null {
  const params = new URL(req.url).searchParams;
  const offset = intParam(params, "offset", 0);
  const limit = intParam(params, "limit", 1);
  if (offset === null || limit === null) return null;
  const cap = limit === undefined ? pageMax : pageMax === null ? limit : Math.min(limit, pageMax);
  return { offset: offset ?? 0, limit: cap };
}

/** The page's slice and its links. `next` repeats the request's own parameters with the next offset. */
export function pageOf<T>(req: Request, items: readonly T[], at: { offset: number; limit: number | null }): { items: T[]; page: Page } {
  const limit = at.limit ?? Math.max(items.length - at.offset, 0);
  const slice = items.slice(at.offset, at.offset + limit);
  let next: string | null = null;
  if (at.offset + slice.length < items.length && limit > 0) {
    const url = new URL(req.url);
    url.searchParams.set("offset", String(at.offset + limit));
    if (at.limit !== null) url.searchParams.set("limit", String(limit));
    next = url.toString();
  }
  return { items: slice, page: { offset: at.offset, limit, total: items.length, next } };
}

export function badPage(): Response {
  return Response.json({ ok: false, error: "offset must be 0 or more and limit 1 or more, whole numbers." }, { status: 400, headers: NO_STORE });
}
