import { publicDropRate, publicMeasuredZero } from "@kb/drop-rollup";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bulkIndex, CREDIT_LINE, LICENCE, LICENCE_URL, PROTOCOL_VERSION, PUBLIC_RECORD_KINDS, SITE, type BulkFile, type BulkIndex } from "@everloot/protocol";
import { filterItems, describe } from "@kb/item-taxonomy";
import { loadStoredAggregates } from "./aggregate-store";
import { attribution } from "./data-guard";
import { gameDataNotice, loadEdges } from "./edges";
import { guildExportRows, guildsOn, loadGuildData } from "./guilds";
import { CLIENT_TAXONOMY as T } from "./items";
import { published, publicInstallSecret } from "./public-install";
import { computeRollups } from "./rollup-compute";
import { cloudConfig, uploadStore } from "./upload-store";

/**
 * The bulk export: the published data as files, one newline-delimited JSON file per dataset plus an
 * index.json (`bulkIndex` in the protocol). Every row is exactly a row the JSON API serves, read through
 * the same loaders, so the export can never hold a row the API would not: records leave with a per-install
 * pseudonym in place of the install id, drops carry tiers from one install and edges follow the three-install rule, items carry the game-file notice; the
 * guild files (agreed kills and the directory, hidden guilds left out) are written only while EVERLOOT_GUILDS is on. A file
 * whose data was unreachable is left out and the index says so through `dataAsOf`; absent is not empty.
 */

type Row = Record<string, unknown>;

interface Dataset {
  file: Omit<BulkFile, "rows" | "bytes" | "sha256">;
  rows: Row[];
}

async function datasets(): Promise<{ sets: Dataset[]; dataAsOf: string | null }> {
  const sets: Dataset[] = [];
  // The CLI runs outside production too: never mistake the loader's local fallback for cloud data.
  const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const missing = required.filter((key) => !process.env[key]?.trim());
  const corpus = cloudConfig() ? await uploadStore.loadCorpus() : { uploads: 0, records: [], unreachable: true, dataAsOf: null };
  if (corpus.unreachable) {
    console.warn(`bulk export: corpus.ndjson omitted: ${missing.length ? `missing ${missing.join(", ")}` : "corpus storage unreachable"}`);
  }
  const dataAsOf = corpus.unreachable ? null : (corpus.dataAsOf ?? null);
  if (!corpus.unreachable) {
    const wanted = new Set<string>(PUBLIC_RECORD_KINDS);
    const secret = publicInstallSecret();
    sets.push({
      file: { name: "corpus.ndjson", dataset: "corpus", format: "ndjson", rowsOf: "corpusPublicResponse", field: "records", data: "observed", attribution: attribution("/database"), gameData: null },
      rows: corpus.records.filter((r) => wanted.has(r.kind)).map((r) => published(r, secret) as Row),
    });
  }
  // Stored drops need only R2; never fall back to local uploads when the cloud corpus is unavailable.
  const stored = await loadStoredAggregates();
  const drops = stored?.drops ?? (!corpus.unreachable ? await computeRollups(corpus) : null);
  if (drops) {
    const { rates, measuredZeros } = drops;
    sets.push({
      file: { name: "drops.ndjson", dataset: "drops", format: "ndjson", rowsOf: "dropsResponse", field: "rates", data: "observed", attribution: attribution("/database/drops"), gameData: null },
      rows: rates.filter((r) => r.reporters > 0).map(publicDropRate) as unknown as Row[],
    });
    sets.push({
      file: { name: "drops-measured-zeros.ndjson", dataset: "drops", format: "ndjson", rowsOf: "dropsResponse", field: "measuredZeros", data: "observed", attribution: attribution("/database/drops"), gameData: null },
      rows: measuredZeros.filter((z) => z.reporters > 0).map(publicMeasuredZero) as unknown as Row[],
    });
  }
  if (guildsOn()) {
    const guilds = await loadGuildData();
    if (!guilds.unreachable) {
      const rows = guildExportRows(guilds);
      sets.push({
        file: { name: "guild-kills.ndjson", dataset: "guilds", format: "ndjson", rowsOf: "guildKillsResponse", field: "kills", data: "observed", attribution: attribution("/guilds"), gameData: null },
        rows: rows.kills,
      });
      sets.push({
        file: { name: "guilds.ndjson", dataset: "guilds", format: "ndjson", rowsOf: "guildsResponse", field: "guilds", data: "observed", attribution: attribution("/guilds"), gameData: null },
        rows: rows.guilds,
      });
    }
  }
  const edges = await loadEdges();
  sets.push({
    file: {
      name: "edges.ndjson", dataset: "edges", format: "ndjson", rowsOf: "edgesResponse", field: "edges", data: edges.unreachable ? "game-files" : "mixed",
      attribution: edges.unreachable ? null : attribution("/database/items"), gameData: gameDataNotice(),
    },
    rows: [...(edges.unreachable ? [] : edges.observed), ...edges.client] as unknown as Row[],
  });
  sets.push({
    file: { name: "items.ndjson", dataset: "items", format: "ndjson", rowsOf: "itemsResponse", field: "items", data: "game-files", attribution: null, gameData: gameDataNotice() },
    rows: filterItems(T, {}).map((r) => describe(T, r) as unknown as Row),
  });
  return { sets, dataAsOf };
}

/** Writes the export into `outDir` and returns its index, which is also written there as index.json. */
export async function exportBulk(outDir: string, now = new Date()): Promise<BulkIndex> {
  mkdirSync(outDir, { recursive: true });
  const { sets, dataAsOf } = await datasets();
  const files: BulkFile[] = [];
  for (const { file, rows } of sets) {
    const body = rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
    const bytes = Buffer.from(body, "utf8");
    writeFileSync(join(outDir, file.name), bytes);
    files.push({ ...file, rows: rows.length, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const index = bulkIndex.parse({
    protocol: PROTOCOL_VERSION,
    generatedAt: now.toISOString(),
    dataAsOf,
    build: gameDataNotice().build,
    site: SITE,
    licence: LICENCE,
    licenceUrl: LICENCE_URL,
    credit: CREDIT_LINE,
    files,
  } satisfies BulkIndex);
  writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
  return index;
}
