import type { UploadSession } from "@/lib/upload-batches";

export type ContributionFile = { installId: string; uploadIds: string[]; completionKeys: string[] };

/** Local-only extraction: observed player/census names and keys never establish a submitter. */
export function contributionFiles(session: UploadSession, payload: unknown): ContributionFile[] {
  const records = (payload as { records?: Array<Record<string, unknown>> } | null)?.records ?? [];
  const files = new Map<string, ContributionFile>();
  session.receipts.forEach((receipt, index) => {
    if (!receipt.ok || !receipt.persisted || !receipt.uploadId) return;
    const batch = JSON.parse(session.batches[index]) as { records: Array<{ installId: string }> };
    const installId = batch.records[0]?.installId;
    if (!installId) return;
    const file = files.get(installId) ?? { installId, uploadIds: [], completionKeys: [] };
    if (!file.uploadIds.includes(receipt.uploadId)) file.uploadIds.push(receipt.uploadId);
    files.set(installId, file);
  });
  for (const row of records) {
    const file = typeof row.installId === "string" ? files.get(row.installId) : null;
    if (!file || typeof row.kind !== "string") continue;
    const key = row.kind === "character_link" ? row.completionKey : row.kind.endsWith("_owned") ? row.characterKey : null;
    if (typeof key === "string" && /^[a-f0-9]{8}$/.test(key) && !file.completionKeys.includes(key)) file.completionKeys.push(key);
  }
  return [...files.values()];
}
