/**
 * The upload page's "Load sample" button fills the preview with made-up rows under a `sample-<uuid>` install id, so
 * people can see the format. Those rows are not observations: intake refuses them, and the corpus never publishes
 * them (`publicRecords`), including the ones stored before intake refused them. Addon ids are hex groups and
 * Recorder ids start with `ps-`, so no real install starts with `sample-`.
 */
export const SAMPLE_INSTALL_PREFIX = "sample-";

export function isSampleInstall(installId: unknown): boolean {
  return typeof installId === "string" && installId.startsWith(SAMPLE_INSTALL_PREFIX);
}
