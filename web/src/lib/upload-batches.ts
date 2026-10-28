import { CLIENT_BUILD, parseRecords, PROTOCOL_VERSION, sharingCategory, UPLOAD_LIMITS, UPLOAD_SOURCES, type SharingCategory } from "@everloot/protocol";
import { recorderSession } from "./polestar-recorder";

export type SharingChoices = Partial<Record<SharingCategory, boolean>>;
export interface BatchReceipt { ok: boolean; persisted?: boolean; uploadId?: string; accepted?: { index: number; kind: string }[]; rejected?: { index: number; reason: string }[]; error?: string }
export interface UploadSession {
  batches: string[]; next: number; receipts: BatchReceipt[];
  counts: Record<string, number>; held: { legacy: number; named: number; invalid: number };
  /** The installed addons this upload sends, one "Title (FolderName)" per folder, for the preview. */
  addons: string[];
  /** Distinct characters in the census rows this upload sends: players seen, and your own. */
  census: { seen: number; self: number };
  /** Event ids of the rows `skip` left out: facts already settled, so the upload does not repeat them. */
  skipped: string[];
}
// census_self and census_seen are being added to @everloot/protocol by the census intake change, so the
// kinds are plain strings here. Until the protocol has them, parseRecords rejects these rows as invalid.
const CENSUS_SEEN = "census_seen", CENSUS_SELF = "census_self";

/** Distinct characters per census kind. A row without a guid is not a character and is not counted. */
export function censusCharacters(records: readonly { kind: string; guid?: unknown }[]): UploadSession["census"] {
  const seen = new Set<string>(), self = new Set<string>();
  for (const { kind, guid } of records) {
    if (typeof guid !== "string" || !guid) continue;
    if (kind === CENSUS_SEEN) seen.add(guid);
    else if (kind === CENSUS_SELF) self.add(guid);
  }
  return { seen: seen.size, self: self.size };
}

/** "312 characters seen, 2 of your own", or null when the upload has no census rows. */
export function censusSummary(census: UploadSession["census"]): string | null {
  if (!census.seen && !census.self) return null;
  return `${census.seen.toLocaleString("en-US")} ${census.seen === 1 ? "character" : "characters"} seen, ${census.self.toLocaleString("en-US")} of your own`;
}
/**
 * Builds the upload's batches. `skip(record)`, when given, leaves out rows whose fact is already settled
 * (kb/src/settled-list.ts `settledSkip`); their event ids are returned in `skipped`, so a caller can mark them handled.
 */
export function prepareUpload(payload: unknown, sharing: SharingChoices, grantTokens: string[], maxBytes: number = UPLOAD_LIMITS.batchBytes,
  skip?: (record: Readonly<Record<string, unknown>>) => boolean): UploadSession {
  const envelope = payload as { addonVersion?: unknown; clientBuild?: unknown; source?: unknown; records?: unknown };
  if (!envelope || typeof envelope.addonVersion !== "string" || envelope.addonVersion.length > UPLOAD_LIMITS.addonVersionMax || !Array.isArray(envelope.records)) throw new Error("Choose an Everloot file with a version and records array.");
  if (envelope.records.length > UPLOAD_LIMITS.recordsPerFile) throw new Error(`This file is too large. Keep the original and split it into files of at most ${UPLOAD_LIMITS.recordsPerFile.toLocaleString("en-US")} records.`);
  if (grantTokens.length > UPLOAD_LIMITS.grantTokensMax || grantTokens.some((token) => !/^[a-f0-9]{64}$/.test(token))) throw new Error("Verification grants must be 64 lowercase hexadecimal characters, one per line (at most four).");
  const parsed = parseRecords(envelope.records);
  const held = { legacy: 0, named: 0, invalid: parsed.receipt.rejected.length };
  const counts: Record<string, number> = {};
  const addons = new Map<string, string>();
  const census: { kind: string; guid?: unknown }[] = [];
  const rows: string[] = [];
  const groups: string[] = [];
  const skipped: string[] = [];
  for (const record of parsed.records) {
    if (!record.eventId) { held.legacy++; continue; }
    const category = sharingCategory(record);
    if (category && !sharing[category]) { held.named++; continue; }
    if (category && !grantTokens.length) throw new Error("A verified grant is required for the named categories you selected.");
    if (!category && skip?.(record as unknown as Record<string, unknown>)) { skipped.push(record.eventId); continue; }
    if ("claimToken" in record) delete record.claimToken;
    if (record.kind === "addon_seen") addons.set(record.name, `${record.title} (${record.name})`);
    if (record.kind.startsWith("census_")) census.push(record as { kind: string; guid?: unknown });
    counts[record.kind] = (counts[record.kind] ?? 0) + 1;
    rows.push(JSON.stringify(record)); groups.push(`${record.installId}|${recorderSession(record.eventId) ?? ""}`);
  }
  // The build is optional metadata: an unreadable one is left out rather than failing every batch.
  const clientBuild = CLIENT_BUILD.safeParse(envelope.clientBuild).success ? envelope.clientBuild : undefined;
  // A converted file says where its rows came from; the server then gives them their install id.
  const source = UPLOAD_SOURCES.find((s) => s === envelope.source);
  const prefix = JSON.stringify({ addonVersion: envelope.addonVersion, clientBuild, protocol: PROTOCOL_VERSION, ...(source ? { source } : {}), sharing, grantTokens }).slice(0, -1) + ',"records":[';
  const suffix = "]}";
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  const overhead = bytes(prefix + suffix);
  const batches: string[] = [];
  let chunk: string[] = [], size = overhead;
  // Intake takes one install per batch, so a file holding several starts a new batch at each change. A Polestar
  // Recorder file also starts one at each session: each session is its own upload.
  for (const [i, row] of rows.entries()) {
    const length = bytes(row);
    if (length + overhead > maxBytes) throw new Error("One record is too large to upload. Keep your file and contact Everloot.");
    if (chunk.length === UPLOAD_LIMITS.recordsPerBatch || size + length + (chunk.length ? 1 : 0) > maxBytes || (chunk.length > 0 && groups[i] !== groups[i - 1])) {
      batches.push(prefix + chunk.join(",") + suffix); chunk = []; size = overhead;
    }
    size += length + (chunk.length ? 1 : 0); chunk.push(row);
  }
  if (chunk.length) batches.push(prefix + chunk.join(",") + suffix);
  return { batches, next: 0, receipts: [], counts, held, addons: [...addons.values()].sort(), census: censusCharacters(census), skipped };
}
/** A per-row refusal, not a request failure or a claim that anything was stored. */
function everyRowRejected(receipt: BatchReceipt, count: number): boolean {
  if (!receipt || typeof receipt !== "object" || receipt.ok !== false || "error" in receipt || "persisted" in receipt || "uploadId" in receipt) return false;
  const { accepted, rejected } = receipt;
  if (!Array.isArray(accepted) || accepted.length || !Array.isArray(rejected) || rejected.length !== count) return false;
  const indices = new Set<number>();
  for (const row of rejected) {
    if (!row || !Number.isInteger(row.index) || row.index < 0 || row.index >= count || indices.has(row.index) || typeof row.reason !== "string") return false;
    indices.add(row.index);
  }
  return true;
}

/** Process durable receipts or exact all-row refusals; retries send the identical unresolved batch. */
export async function sendBatches(session: UploadSession, send: typeof fetch = fetch, onProgress: () => void = () => {}, url = "/api/intake") {
  while (session.next < session.batches.length) {
    const body = session.batches[session.next];
    const response = await send(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const receipt = await response.json() as BatchReceipt;
    const count = JSON.parse(body).records.length;
    const rejected = response.status === 422 && everyRowRejected(receipt, count);
    if (!rejected && (!response.ok || !receipt?.ok || receipt.persisted !== true || !receipt.uploadId || !Array.isArray(receipt.accepted) ||
      receipt.accepted.length + (receipt.rejected?.length ?? 0) !== count)) {
      throw new Error(receipt?.error ?? "Storage was not confirmed. Keep your file and retry.");
    }
    session.receipts.push(receipt); session.next++; onProgress();
  }
}
