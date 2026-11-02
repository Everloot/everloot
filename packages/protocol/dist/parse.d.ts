import { type IntakeRecord, type RecordKind, type StoredRecord, type UploadSource } from "./records.js";
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
export type ParsedUpload = {
    ok: true;
    upload: CanonicalUpload;
    receipt: ValidationResult;
} | {
    ok: false;
    receipt: ValidationResult;
};
/**
 * `runRecords: false` parses as intake did before pull timing, runs and pull summaries: `encounter` rows without their
 * timing fields, and `instance_run` and `pull_summary` as unknown kinds. Intake passes it while the site's
 * `EVERLOOT_PULL_SUMMARIES` switch is off. Everything else reads the whole contract.
 */
export interface ParseOptions {
    runRecords?: boolean;
}
/**
 * Parse every record against its own kind schema, keeping the parsed value and the original
 * index. Only own `kind` keys name a schema: inherited or prototype keys are unknown kinds.
 */
export declare function parseRecords(records: readonly unknown[], options?: ParseOptions): ParsedRecords;
/**
 * Parse an upload envelope. `ok` means the envelope itself parsed, so a valid envelope whose
 * rows were all rejected still returns an upload with zero records — callers decide what that means.
 * An envelope from a protocol major the server no longer accepts is refused whole.
 */
export declare function parseUpload(payload: unknown, options?: ParseOptions): ParsedUpload;
/**
 * Validate an upload: every record is checked against its kind schema.
 * Implausible data is rejected with a reason; nothing is stored here.
 * Rate limits (per install / per IP) are enforced at the route layer.
 */
export declare function validateUpload(payload: unknown): ValidationResult;
/** Summarize accepted records for the pre-send preview: counts per kind, never names. */
export declare function summarizeKinds(records: IntakeRecord[]): Partial<Record<string, number>>;
