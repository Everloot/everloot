import { agreedCatalog } from "../../../kb/src/completion-rollup";
import type { FactNames } from "./character-facts";
import type { StoredFact } from "./private-sync-store";
import { uploadStore } from "./upload-store";

/**
 * The names a character's synced facts are shown with, read only when it has synced titles: the agreed completion
 * catalog. A read that fails leaves the titles out, so a slow store never takes the page down. Server only.
 */
export async function loadFactNames(facts: readonly StoredFact[]): Promise<FactNames> {
  const catalog = facts.some((f) => f.category === "achievements")
    ? await uploadStore.loadCompletion().then((read) => (read.state ? agreedCatalog(read.state) : null)).catch(() => null)
    : null;
  return { catalog };
}
