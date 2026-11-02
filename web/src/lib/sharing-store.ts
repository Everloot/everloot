import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CloudConfig } from "./upload-store";
import { publicRecords, namedRecord, type CorpusState } from "../../../kb/src/corpus";
import { authorizeRecord, type PublicationState, type PublicationGrant } from "../../../kb/src/publication";
import { readAllRows } from "./postgrest-pages";

const grantSchema = z.object({
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/), installId: z.string().min(8).max(128),
  realm: z.string().trim().min(1).max(128), subject: z.string().trim().min(1).max(128),
  subjectType: z.enum(["guild", "character", "install"]),
  categories: z.array(z.enum(["guild", "gear", "gold", "collection"])).min(1).max(4),
  expiresAt: z.string().datetime(), verifiedBy: z.string().trim().min(1).max(128),
  evidence: z.string().trim().min(10).max(2000), revokedAt: z.string().datetime().nullable(),
});
const suppressionSchema = z.object({ realm: z.string().min(1), character: z.string().min(1) });
export type GrantInput = Omit<PublicationGrant, "tokenHash" | "revokedAt">;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Private operator-issued grants. No public endpoint can issue or verify authority. */
export function createSharingStore(opts: { cloud: CloudConfig | null; localDir: string; now?: () => Date; fetch?: typeof fetch }) {
  const requireStorage = () => { if (!opts.cloud && process.env.NODE_ENV === "production") throw new Error("Production publication storage is not configured"); };
  const now = opts.now ?? (() => new Date());
  const doFetch = opts.fetch ?? fetch;
  const folder = (name: string) => join(opts.localDir, name);
  const headers: Record<string, string> = opts.cloud ? { apikey: opts.cloud.supabaseServiceKey, Authorization: `Bearer ${opts.cloud.supabaseServiceKey}`, "Content-Type": "application/json" } : {};
  async function request(path: string, init: RequestInit = {}) {
    const requestHeaders = new Headers(headers);
    new Headers(init.headers).forEach((value, key) => requestHeaders.set(key, value));
    const response = await doFetch(`${opts.cloud!.supabaseUrl.replace(/\/$/, "")}/rest/v1/${path}`, {
      ...init, headers: requestHeaders, cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Publication storage unavailable (${response.status})`);
    return response;
  }
  async function list(table: string): Promise<unknown[]> {
    requireStorage();
    // A list the pages cannot show to be complete is an error, so the corpus is withheld rather than published past it.
    if (opts.cloud) {
      return readAllRows((offset) => request(`${table}?select=*&order=${table === "publication_grants" ? "token_hash" : "realm,character"}&limit=1000&offset=${offset}`,
        { headers: { Prefer: "count=exact" } }));
    }
    let names: string[];
    try { names = await readdir(folder(table === "publication_grants" ? "grants" : "suppressions")); }
    catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") return []; throw err; }
    return Promise.all(names.filter((n) => /^[a-f0-9]{64}\.json$/.test(n)).map(async (n) => JSON.parse(await readFile(join(folder(table === "publication_grants" ? "grants" : "suppressions"), n), "utf8"))));
  }
  async function loadState(): Promise<PublicationState> {
    const [grants, suppressions] = await Promise.all([list("publication_grants"), list("character_suppressions")]);
    return { grants: grants.map((row) => {
      if (!opts.cloud) return grantSchema.parse(row);
      const stored = row as { token_hash: string; grant: unknown; revoked_at: string | null };
      return grantSchema.parse({ ...(stored.grant as object), tokenHash: stored.token_hash, revokedAt: stored.revoked_at });
    }), suppressions: suppressions.map((row) => suppressionSchema.parse(row)) };
  }
  async function lookup(token: string): Promise<PublicationGrant | null> {
    requireStorage();
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const tokenHash = hash(token);
    if (opts.cloud) {
      const rows = await (await request(`publication_grants?token_hash=eq.${tokenHash}&select=*`)).json() as { token_hash: string; grant: object; revoked_at: string | null }[];
      if (!rows.length) return null;
      return grantSchema.parse({ ...rows[0].grant, tokenHash: rows[0].token_hash, revokedAt: rows[0].revoked_at });
    }
    try { return grantSchema.parse(JSON.parse(await readFile(join(folder("grants"), `${tokenHash}.json`), "utf8"))); }
    catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") return null; throw err; }
  }
  async function issue(input: GrantInput) {
    requireStorage();
    const token = randomBytes(32).toString("hex");
    const grant = grantSchema.parse({ ...input, tokenHash: hash(token), revokedAt: null });
    const compatible = grant.categories.every((category) => grant.subjectType === "guild" ? category === "guild" : grant.subjectType === "character" ? category === "gold" || category === "gear" : category === "collection");
    if (!compatible || Date.parse(grant.expiresAt) <= now().getTime()) throw new Error("Grant must have compatible scopes and a future expiry");
    if (opts.cloud) await request("publication_grants", { method: "POST", body: JSON.stringify({ token_hash: grant.tokenHash, grant, revoked_at: null }) });
    else {
      await mkdir(folder("grants"), { recursive: true });
      await writeFile(join(folder("grants"), `${grant.tokenHash}.json`), JSON.stringify(grant), { encoding: "utf8", flag: "wx", mode: 0o600 });
    }
    return { token, tokenHash: grant.tokenHash };
  }
  async function revoke(token: string) {
    const grant = await lookup(token);
    if (!grant) return false;
    const revokedAt = now().toISOString();
    if (opts.cloud) await request(`publication_grants?token_hash=eq.${grant.tokenHash}`, { method: "PATCH", body: JSON.stringify({ revoked_at: revokedAt }) });
    else {
      const target = join(folder("grants"), `${grant.tokenHash}.json`);
      const temp = `${target}.${randomBytes(8).toString("hex")}.tmp`;
      await writeFile(temp, JSON.stringify({ ...grant, revokedAt }), { encoding: "utf8", mode: 0o600 });
      await rename(temp, target);
    }
    return true;
  }
  async function optOut(token: string) {
    const grant = await lookup(token);
    if (!grant || grant.subjectType !== "character") return false;
    const suppression = { realm: grant.realm.trim().toLowerCase(), character: grant.subject.trim().toLowerCase() };
    if (opts.cloud) await request("character_suppressions?on_conflict=realm,character", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify(suppression) });
    else {
      await mkdir(folder("suppressions"), { recursive: true });
      const target = join(folder("suppressions"), `${hash(JSON.stringify(suppression))}.json`);
      try { await writeFile(target, JSON.stringify(suppression), { encoding: "utf8", flag: "wx" }); }
      catch (err) { if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err; }
    }
    return true;
  }
  async function publish(state: CorpusState) {
    if (!state.events.some((event) => namedRecord(event.record))) return publicRecords(state);
    const authority = await loadState();
    return publicRecords(state, (row, hashes) => authorizeRecord(row, hashes, authority, now()));
  }
  return { issue, lookup, loadState, revoke, optOut, publish };
}
