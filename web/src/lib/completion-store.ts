import { authorizedOwners, completionFactsOf } from "@kb/completion-rollup";
import type { CompletionFacts } from "@kb/completion";
import { sharingStore, uploadStore } from "./upload-store";

/**
 * What the completion page and the MCP tool read for one install: the agreed catalog (computed once per
 * rollup the store hands out) and that install's owned progress when its grant is live right now. Only the
 * requested install is checked and built. Null when the rollup could not be read, which is unrecorded, not zero.
 */
export async function loadCompletion(installId: string): Promise<{ facts: CompletionFacts; dataAsOf: string | null } | null> {
  const read = await uploadStore.loadCompletion();
  if (!read.state) return null;
  const install = installId.trim();
  const owners = read.state.owned[install]
    ? authorizedOwners(read.state, await sharingStore.loadState(), new Date(), install)
    : new Set<string>();
  return { facts: completionFactsOf(read.state, owners, install), dataAsOf: read.dataAsOf };
}
