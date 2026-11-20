import { CLIENT_EDGES, CLIENT_LAYER } from "@kb/client-layer-file";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { CLIENT_LABEL, type Edge, type EdgeKind, type Evidence, type Rel } from "@kb/edges";
import { loadObservedEdges } from "./rollup-compute";

export { CLIENT_EDGES, CLIENT_LAYER };

/**
 * What the game-file rows carry instead of our licence: the label, the build and the notice. Sent beside
 * `attribution` (CC BY-SA, for the observed rows) whenever a client row is in the answer.
 */
export function gameDataNotice() {
  return {
    label: CLIENT_LABEL,
    build: CLIENT_LAYER.build.version,
    extractedAt: CLIENT_LAYER.build.extractedAt,
    licence: "Blizzard's data, not under Everloot's licence",
    credit: GAME_DATA_CREDIT,
  };
}

/** Relations seen in play (3 installs) and found in the game files (the committed client layer), together. */
export async function loadEdges(): Promise<{ observed: Edge[]; client: Edge[]; unreachable: boolean; dataAsOf: string | null }> {
  const { edges, unreachable, dataAsOf } = await loadObservedEdges();
  return { observed: edges, client: CLIENT_EDGES, unreachable, dataAsOf };
}

export interface EdgeFilter {
  fromKind?: EdgeKind; fromId?: number; toKind?: EdgeKind; toId?: number; rel?: Rel; evidence?: Evidence;
}

export function filterEdges(edges: readonly Edge[], f: EdgeFilter): Edge[] {
  return edges.filter((e) =>
    (f.fromKind === undefined || e.fromKind === f.fromKind) && (f.fromId === undefined || e.fromId === f.fromId)
    && (f.toKind === undefined || e.toKind === f.toKind) && (f.toId === undefined || e.toId === f.toId)
    && (f.rel === undefined || e.rel === f.rel) && (f.evidence === undefined || e.evidence === f.evidence));
}
