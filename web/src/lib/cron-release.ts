import { forgetAllKept } from "./kept";
import { sharingStore, uploadStore } from "./upload-store";

/**
 * Let go of what a cron run's steps so far read and kept for pages: the stores keep each file they read or write, tens of
 * MB apiece, and one run reads them all. Kept to the end of the run they added up past the Worker's 128 MB (#1354). The
 * snapshot run (api/cron/snapshot) and the stored-views run (api/cron/views) call it between their steps.
 */
export function releaseCronReads(): void {
  uploadStore.forgetReads();
  sharingStore.forgetPublished();
  forgetAllKept();
}
