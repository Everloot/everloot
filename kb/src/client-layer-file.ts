import layerJson from "../../web/src/data/game-data/client-layer.json" with { type: "json" };
import { readLayerEdges, readLayerSkills, readLayerTaxonomy, type ClientLayer } from "./client-layer.js";
import type { Edge } from "./edges.js";
import type { Taxonomy } from "./item-taxonomy.js";

/**
 * The committed client layer. The MCP tools and the site read the same file. It is checked against the schema by
 * client-layer-file.test.ts, which also holds that parsing returns it unchanged: parsing it here at load made a second
 * copy of every edge and item, about 15 MB of heap in Node, in every Worker that imports it (#1354).
 */
export const CLIENT_LAYER: ClientLayer = layerJson as unknown as ClientLayer;
export const CLIENT_EDGES: Edge[] = readLayerEdges(CLIENT_LAYER);
export const CLIENT_TAXONOMY: Taxonomy = readLayerTaxonomy(CLIENT_LAYER);
/** Profession id -> name, for the relations that say which profession teaches a spell. */
export const CLIENT_SKILLS: Map<number, string> = readLayerSkills(CLIENT_LAYER);
