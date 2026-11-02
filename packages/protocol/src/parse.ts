import { encounterEndBeforeRuns, recordSchemas, RUN_RECORD_KINDS, uploadPayload, type IntakeRecord, type RecordKind, type StoredRecord, type UploadSource } from "./records.js";
import { ACCEPTED_MAJORS, protocolMajor } from "./version.js";

export interface AcceptedRecord {
  index: number;
  kind: RecordKind;
}

export interface RejectedRecord {
  index: number;
  reason: string;
}

export interface ValidationResult {
  accepted: AcceptedRecord[];
  rejected: RejectedRecord[];
}

/** An upload reduced to its accepted records: what a store may persist, what a corpus may serve. */
export interface CanonicalUpload {
  addonVersion: string;
  clientBuild?: string;
  /**
   * Keyed hash of the upload address, added by the intake route, never read from the request body.
   * The market counts installs behind one address once. Never published.
   */
  reporter?: string;
  /** Set when the rows were converted from another addon's file (`UPLOAD_SOURCES`); absent for the Everloot addon's own. */
  source?: UploadSource;
  records: IntakeRecord[];
}

/** What the intake route stores: the canonical upload with every census GUID already swapped for a key. */
export interface StoredUpload extends Omit<CanonicalUpload, "records"> {
  records: StoredRecord[];
}

export interface ParsedRecords {
  records: IntakeRecord[];
  receipt: ValidationResult;
}

export type ParsedUpload =
  | { ok: true; upload: CanonicalUpload; receipt: ValidationResult }
  | { ok: false; receipt: ValidationResult };

/** The record's own `kind`; a prototype or inherited key never names a schema. */
function ownKindOf(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || !Object.hasOwn(raw, "kind")) return undefined;
  return (raw as { kind: unknown }).kind;
}

/**
 * `runRecords: false` parses as intake did before pull timing, runs and pull summaries: `encounter` rows without their
 * timing fields, and `instance_run` and `pull_summary` as unknown kinds. Intake passes it while the site's
 * `EVERLOOT_PULL_SUMMARIES` switch is off. Everything else reads the whole contract.
 */
export interface ParseOptions { runRecords?: boolean }

function schemaFor(kind: string, options: ParseOptions) {
  if (options.runRecords === false) {
    if (kind === "encounter") return encounterEndBeforeRuns;
    if (RUN_RECORD_KINDS.includes(kind)) return undefined;
  }
  return recordSchemas[kind as RecordKind];
}

/**
 * Parse every record against its own kind schema, keeping the parsed value and the original
 * index. Only own `kind` keys name a schema: inherited or prototype keys are unknown kinds.
 */
export function parseRecords(records: readonly unknown[], options: ParseOptions = {}): ParsedRecords {
  const parsed: IntakeRecord[] = [];
  const accepted: AcceptedRecord[] = [];
  const rejected: RejectedRecord[] = [];
  records.forEach((raw, index) => {
    const kind = ownKindOf(raw);
    const schema =
      typeof kind === "string" && Object.hasOwn(recordSchemas, kind)
        ? schemaFor(kind, options)
        : undefined;
    if (!schema) {
      rejected.push({ index, reason: `unknown kind: ${String(kind)}` });
      return;
    }
    const r = schema.safeParse(raw);
    if (r.success) {
      parsed.push(r.data as IntakeRecord);
      accepted.push({ index, kind: kind as RecordKind });
    } else {
      rejected.push({ index, reason: r.error.issues[0]?.message ?? "invalid record" });
    }
  });
  return { records: parsed, receipt: { accepted, rejected } };
}

const envelopeRefused = (reason: string): ParsedUpload => ({ ok: false, receipt: { accepted: [], rejected: [{ index: -1, reason }] } });

/**
 * Parse an upload envelope. `ok` means the envelope itself parsed, so a valid envelope whose
 * rows were all rejected still returns an upload with zero records — callers decide what that means.
 * An envelope from a protocol major the server no longer accepts is refused whole.
 */
export function parseUpload(payload: unknown, options: ParseOptions = {}): ParsedUpload {
  const parsed = uploadPayload.safeParse(payload);
  if (!parsed.success) return envelopeRefused("payload needs addonVersion + records[1..2000]");
  const { addonVersion, clientBuild, protocol, source } = parsed.data;
  if (protocol !== undefined && !ACCEPTED_MAJORS.includes(protocolMajor(protocol) ?? -1)) {
    return envelopeRefused(`protocol ${protocol} is not supported; update the addon or uploader`);
  }
  const { records, receipt } = parseRecords(parsed.data.records, options);
  return { ok: true, upload: { addonVersion, ...(clientBuild ? { clientBuild } : {}), ...(source ? { source } : {}), records }, receipt };
}

/**
 * Validate an upload: every record is checked against its kind schema.
 * Implausible data is rejected with a reason; nothing is stored here.
 * Rate limits (per install / per IP) are enforced at the route layer.
 */
export function validateUpload(payload: unknown): ValidationResult {
  return parseUpload(payload).receipt;
}

/** Summarize accepted records for the pre-send preview: counts per kind, never names. */
export function summarizeKinds(records: IntakeRecord[]): Partial<Record<string, number>> {
  const counts: Partial<Record<string, number>> = {};
  for (const r of records) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  return counts;
}
