// Terrain types and the gear bound to them, read from our own game file extract. The JSON beside this file is generated
// by `npm run kb -- client-terrain` (see README.md); do not edit it by hand.
import terrainJson from "./client-terrain.json";
import { ClientTerrain } from "../../../../kb/src/client-terrain";

export const CLIENT_TERRAIN: ClientTerrain = ClientTerrain.parse(terrainJson);
