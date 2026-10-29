import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { AwsClient } from "aws4fetch";
import pg from "pg";

const REF = "uinmowrmyckklpbwzqhn";
const UPLOAD_ID = "1d694078-785b-4812-8466-69fcf7c8670b";
const UPLOAD_FILTER = `uploads?id=eq.${UPLOAD_ID}&install_id=eq.e2e-test-20261004`;
const WAITLIST_FILTER = "waitlist?email=eq.e2e-test%40everloot.app&tool_slug=eq.e2e-test";

// This maintenance job runs with production credentials in the environment (scripts/cleanup-test-data.ps1).
// Credentials stay there; only operation counts and schema names enter build logs.
export async function cleanupTestData({ rest, r2 }) {
  const rows = await rest(`uploads?id=eq.${UPLOAD_ID}&select=id,install_id,object_key,record_count`);
  const waitlist = await rest(`${WAITLIST_FILTER}&select=email,tool_slug,created_at`);
  const row = rows[0];
  let payload;
  if (row) {
    if (rows.length !== 1 || row.install_id !== "e2e-test-20261004" || row.record_count !== 1 ||
      !new RegExp(`^uploads/\\d{4}-\\d{2}-\\d{2}/${UPLOAD_ID}\\.json$`).test(row.object_key)) {
      throw new Error("Test upload identity mismatch");
    }
    const object = await r2(row.object_key, { method: "GET" });
    if (object.ok) {
      payload = await object.json();
      if (payload.records?.length !== 1 || payload.records[0].installId !== "e2e-test-20261004" || payload.records[0].itemId !== 999999001) {
        throw new Error("Test object identity mismatch");
      }
    } else if (object.status !== 404) throw new Error("Test object could not be read");
  }
  if (row || waitlist.length) {
    const backup = await r2(`maintenance-backups/2026-10-07/${UPLOAD_ID}.json`, {
      method: "PUT", headers: { "content-type": "application/json", "if-none-match": "*" },
      body: JSON.stringify({ upload: row, payload, waitlist }),
    });
    if (!backup.ok && backup.status !== 412) throw new Error("Test-data backup failed; nothing deleted");
  }
  if (row) {
    const deleted = await r2(row.object_key, { method: "DELETE" });
    if (!deleted.ok && deleted.status !== 404) throw new Error("R2 test object deletion failed");
    await rest(UPLOAD_FILTER, { method: "DELETE" });
  }
  if (waitlist.length) await rest(WAITLIST_FILTER, { method: "DELETE" });
  if ((await rest(UPLOAD_FILTER)).length || (await rest(WAITLIST_FILTER)).length) throw new Error("Test-data deletion verification failed");
  if (row && (await r2(row.object_key, { method: "HEAD" })).status !== 404) throw new Error("R2 test object still exists");
  return { uploadRemoved: !!row, waitlistRemoved: waitlist.length > 0 };
}

async function main() {
  const action = process.env.EVERLOOT_MAINTENANCE_ACTION;
  if (!['preflight', 'apply-schema-and-cleanup', 'apply-intake-quota'].includes(action)) throw new Error("An explicit maintenance action is required");
  if (new URL(process.env.SUPABASE_URL).hostname !== `${REF}.supabase.co` || process.env.R2_BUCKET !== "everloot-uploads") {
    throw new Error("Maintenance target does not match Everloot production");
  }
  const url = new URL(process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL);
  if (url.hostname !== `db.${REF}.supabase.co` && !decodeURIComponent(url.username).endsWith(`.${REF}`)) {
    throw new Error("Postgres target does not match Everloot production");
  }
  url.searchParams.delete("sslmode");
  const ca = await readFile(process.env.SUPABASE_DB_CA_PATH || new URL("../../supabase/certs/prod-ca-2021.crt", import.meta.url), "utf8");
  const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: true, ca }, connectionTimeoutMillis: 15000 });
  await client.connect();
  try {
    const before = await client.query("select table_name, column_name from information_schema.columns where table_schema='public' order by table_name, ordinal_position");
    console.log("Everloot schema preflight:", JSON.stringify(before.rows));
    if (action === "preflight") return;
    if (action === "apply-intake-quota") {
      const quota = await readFile(new URL("../../supabase/migrations/20261007220000_intake_quotas.sql", import.meta.url), "utf8");
      await client.query('BEGIN');
      try {
        await client.query(quota);
        const check = await client.query(`select relrowsecurity from pg_class where oid='public.intake_quota_buckets'::regclass`);
        if (!check.rows[0]?.relrowsecurity) throw new Error("Quota RLS verification failed");
        for (const role of ['anon', 'authenticated']) {
          const access = await client.query(`select has_function_privilege($1, 'public.consume_intake_quota(text,text)', 'execute') as execute,
            has_table_privilege($1, 'public.intake_quota_buckets', 'select,insert,update,delete') as access`, [role]);
          if (access.rows[0].execute || access.rows[0].access) throw new Error("Quota browser privilege verification failed");
        }
        const server = await client.query(`select has_function_privilege('service_role', 'public.consume_intake_quota(text,text)', 'execute') as execute,
          has_table_privilege('service_role', 'public.intake_quota_buckets', 'select') as read,
          has_table_privilege('service_role', 'public.intake_quota_buckets', 'delete') as prune`);
        if (!server.rows[0].execute || !server.rows[0].read || !server.rows[0].prune) throw new Error("Quota server privilege verification failed");
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      console.log("Intake quota schema verified: private RLS table; browser execution revoked; service-only atomic admission.");
      return;
    }
    // Refuse to reinterpret an existing session table from a different auth model.
    if (before.rows.some(r => r.table_name === 'sessions') && !before.rows.some(r => r.table_name === 'sessions' && r.column_name === 'token_hash')) {
      throw new Error("Existing session schema requires a reviewed migration");
    }
    const schema = await readFile(new URL("../../supabase/migrations/20261003000000_auth_schema.sql", import.meta.url), "utf8");
    const publication = await readFile(new URL("../../supabase/migrations/20261007070647_verified_publication.sql", import.meta.url), "utf8");
    await client.query('BEGIN');
    try { await client.query(schema); await client.query(publication); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    const tables = await client.query("select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname in ('users','sessions','profiles','entitlements','characters','suppressions','revoked_guilds','revoked_tokens','publication_grants','character_suppressions') order by relname");
    if (tables.rows.length !== 10 || tables.rows.some(r => !r.relrowsecurity)) throw new Error("Auth/publication RLS verification failed");
    const grants = await client.query("select table_name from information_schema.table_privileges where table_schema='public' and grantee in ('anon','authenticated') and table_name in ('users','sessions','profiles','entitlements','characters','suppressions','revoked_guilds','revoked_tokens','publication_grants','character_suppressions')");
    if (grants.rows.length) throw new Error("Auth tables still grant browser access");
    console.log("Auth/publication schema verified: 10 private tables, RLS enabled, no browser grants.");
  } finally { await client.end(); }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const rest = async (path, init = {}) => {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
      ...init, headers: { apikey: key, authorization: `Bearer ${key}`, prefer: "return=representation" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Maintenance database request failed (${response.status})`);
    return response.status === 204 ? [] : response.json();
  };
  const aws = new AwsClient({ accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
  const r2 = async (key, init) => {
    const request = await aws.sign(`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/everloot-uploads/${key}`, init);
    return fetch(request, { signal: AbortSignal.timeout(15000) });
  };
  console.log("Test-data cleanup verified:", JSON.stringify(await cleanupTestData({ rest, r2 })));
  const { uploadStore } = await import("../src/lib/upload-store.ts");
  const current = await r2("snapshots/corpus.json", { method: "GET", headers: { "accept-encoding": "identity" } });
  console.log("Snapshot conditional-write preflight:", JSON.stringify({ status: current.status, etag: current.headers.get("etag") }));
  await current.body?.cancel();
  for (let attempt = 1; ; attempt++) {
    try { console.log("Corpus rebuilt:", JSON.stringify(await uploadStore.writeSnapshot({ rebuild: true }))); break; }
    catch (error) {
      if (error.message !== "snapshot write failed (412)" || attempt >= 3) throw error;
      console.log("Snapshot precondition failed; rereading for a conditional retry.");
    }
  }
  const corpus = await uploadStore.loadCorpus();
  if (corpus.unreachable || corpus.records.some(r => r.installId === "e2e-test-20261004")) throw new Error("Corpus verification failed");
  console.log("Corpus verified:", JSON.stringify({ uploads: corpus.uploads, records: corpus.records.length }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error("Everloot maintenance failed:", error.code || error.message); process.exitCode = 1; });
}
