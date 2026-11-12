type OpsEnvironment = Record<string, string | undefined>;
type OpsSurface = "human" | "summary" | "contributors";
type OpsPrincipal = { kind: "human" | "agent"; id: string };

const members = (value?: string) => value?.split(",").map((id) => id.trim()).filter(Boolean) ?? [];

function agentToken(token: string, env: OpsEnvironment): OpsPrincipal | null {
  const registry: unknown = JSON.parse(env.EVERLOOT_OPS_AGENT_TOKEN_HASHES || "{}");
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) return null;
  const hash = createHash("sha256").update(token).digest();
  for (const [id, stored] of Object.entries(registry)) {
    if (id && typeof stored === "string" && /^[a-f0-9]{64}$/i.test(stored)
      && timingSafeEqual(hash, Buffer.from(stored, "hex"))) return { kind: "agent", id };
  }
  return null;
}

async function accessToken(token: string, env: OpsEnvironment): Promise<OpsPrincipal | null> {
  const issuer = env.EVERLOOT_OPS_ACCESS_ISSUER;
  const audience = env.EVERLOOT_OPS_ACCESS_AUDIENCE;
  if (!issuer || !audience || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || token.length > 16_384) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as Record<string, unknown>;
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as Record<string, unknown>;
  if (header.alg !== "RS256" || typeof header.kid !== "string" || header.crit !== undefined) return null;
  const now = Date.now() / 1000;
  if (claims.iss !== issuer || typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now
    || (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > now))
    || !(claims.aud === audience || (Array.isArray(claims.aud) && claims.aud.includes(audience)))) return null;
  const response = await fetch(`${issuer}/cdn-cgi/access/certs`, { cache: "no-store", signal: AbortSignal.timeout(5_000), redirect: "error" });
  if (!response.ok) return null;
  const jwks = await response.json() as { keys?: Array<JsonWebKey & { kid?: string }> };
  const jwk = jwks.keys?.find((key) => key.kid === header.kid && key.kty === "RSA" && (!key.alg || key.alg === "RS256") && (!key.use || key.use === "sig"));
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, Buffer.from(parts[2], "base64url"), Buffer.from(`${parts[0]}.${parts[1]}`))) return null;
  // Access service JWTs carry common_name. An explicitly registered service
  // subject without an email is also accepted; neither can become a human.
  const isService = Object.hasOwn(claims, "common_name") || !claims.email;
  if (isService) {
    const service = Object.hasOwn(claims, "common_name") ? claims.common_name : claims.sub;
    return typeof service === "string" && service && members(env.EVERLOOT_OPS_ACCESS_SERVICE_SUBJECTS).includes(service)
      ? { kind: "agent", id: service } : null;
  }
  if (typeof claims.sub === "string" && claims.sub && typeof claims.email === "string" && claims.email
    && (members(env.EVERLOOT_OPS_ACCESS_HUMAN_SUBJECTS).includes(claims.sub)
      || members(env.EVERLOOT_OPS_ACCESS_HUMAN_EMAILS).includes(claims.email))) return { kind: "human", id: claims.sub };
  return null;
}

/** Separate server-owned grants: player keys/scopes never confer operations access. */
export async function authorizeOps(req: Request, surface: OpsSurface, env: OpsEnvironment = process.env): Promise<OpsPrincipal | null> {
  try {
    // Explicit machine credentials cannot fall back to a browser session.
    const bearer = req.headers.get("authorization");
    if (bearer !== null) {
      if (surface !== "summary" || !/^Bearer \S+$/i.test(bearer)) return null;
      return agentToken(bearer.slice(7), env);
    }
    const assertion = req.headers.get("cf-access-jwt-assertion");
    if (assertion !== null) {
      const principal = await accessToken(assertion, env);
      if (!principal || (principal.kind === "agent" && surface !== "summary")) return null;
      if (surface === "contributors") {
        // Named detail is an additional human permission, independent of page/aggregate access.
        const claims = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString()) as { email?: string };
        if (!members(env.EVERLOOT_OPS_ACCESS_CONTRIBUTOR_SUBJECTS).includes(principal.id)
          && !(claims.email && members(env.EVERLOOT_OPS_ACCESS_CONTRIBUTOR_EMAILS).includes(claims.email))) return null;
      }
      return principal;
    }
    const allowed = members(env.EVERLOOT_OPS_USER_IDS);
    if (!allowed.length) return null;
    const user = await getUser();
    return user && allowed.includes(user.id) && (surface !== "contributors" || members(env.EVERLOOT_OPS_CONTRIBUTOR_USER_IDS).includes(user.id))
      ? { kind: "human", id: user.id } : null;
  } catch {
    return null;
  }
}
import { createHash, timingSafeEqual } from "node:crypto";
import { getUser } from "@/lib/supabase/server";

