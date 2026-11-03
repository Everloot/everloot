import { encounterEndBeforeRuns, recordSchemas, RUN_RECORD_KINDS, uploadPayload } from "./records.js";
import { ACCEPTED_MAJORS, protocolMajor } from "./version.js";
/** The record's own `kind`; a prototype or inherited key never names a schema. */
function ownKindOf(raw) {
    if (typeof raw !== "object" || raw === null || !Object.hasOwn(raw, "kind"))
        return undefined;
    return raw.kind;
}
function schemaFor(kind, options) {
    if (options.runRecords === false) {
        if (kind === "encounter")
            return encounterEndBeforeRuns;
        if (RUN_RECORD_KINDS.includes(kind))
            return undefined;
    }
    return recordSchemas[kind];
}
/**
 * Parse every record against its own kind schema, keeping the parsed value and the original
 * index. Only own `kind` keys name a schema: inherited or prototype keys are unknown kinds.
 */
export function parseRecords(records, options = {}) {
    const parsed = [];
    const accepted = [];
    const rejected = [];
    records.forEach((raw, index) => {
        const kind = ownKindOf(raw);
        const schema = typeof kind === "string" && Object.hasOwn(recordSchemas, kind)
            ? schemaFor(kind, options)
            : undefined;
        if (!schema) {
            rejected.push({ index, reason: `unknown kind: ${String(kind)}` });
            return;
        }
        const r = schema.safeParse(raw);
        if (r.success) {
            parsed.push(r.data);
            accepted.push({ index, kind: kind });
        }
        else {
            rejected.push({ index, reason: r.error.issues[0]?.message ?? "invalid record" });
        }
    });
    return { records: parsed, receipt: { accepted, rejected } };
}
const envelopeRefused = (reason) => ({ ok: false, receipt: { accepted: [], rejected: [{ index: -1, reason }] } });
/**
 * Parse an upload envelope. `ok` means the envelope itself parsed, so a valid envelope whose
 * rows were all rejected still returns an upload with zero records — callers decide what that means.
 * An envelope from a protocol major the server no longer accepts is refused whole.
 */
export function parseUpload(payload, options = {}) {
    const parsed = uploadPayload.safeParse(payload);
    if (!parsed.success)
        return envelopeRefused("payload needs addonVersion + records[1..2000]");
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
export function validateUpload(payload) {
    return parseUpload(payload).receipt;
}
/** Summarize accepted records for the pre-send preview: counts per kind, never names. */
export function summarizeKinds(records) {
    const counts = {};
    for (const r of records)
        counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    return counts;
}
