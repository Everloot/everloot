/**
 * Writes the bulk export (web/src/lib/bulk-export.ts) into a folder: one NDJSON file per dataset and an
 * index.json. Reads the same storage the site reads, so run it with the production R2 variables
 * (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET) and corpus index variables
 * (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY):
 *   npm run export-bulk -- <outDir>
 * Then upload the folder with scripts/upload-bulk.mjs. See docs/RELEASING.md, "Bulk export".
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exportBulk } from "../src/lib/bulk-export";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outDir = process.argv[2];
  if (!outDir || outDir.startsWith("-")) {
    console.error("usage: npm run export-bulk -- <outDir>");
    process.exit(2);
  }
  exportBulk(resolve(outDir)).then((index) => {
    for (const f of index.files) console.log(`${f.name}: ${f.rows} rows, ${f.bytes} bytes, ${f.data}`);
    console.log(`index.json: data as of ${index.dataAsOf ?? "unreachable (observed files absent)"}, build ${index.build}`);
  }, (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
