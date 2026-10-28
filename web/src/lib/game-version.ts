import clientLayer from "@/data/game-data/client-layer.json";
import { LAUNCH } from "@/data/wow-forever";

/**
 * The game versions the site knows, Live / PTR / Beta as on WoWDB. One list: the header label, the
 * tests and the docs (docs/ASSETS.md, "Adding a product or build") all start here. The Beta build is
 * read from the committed game-data layers, so a build bump is one regenerated file, not an edit here.
 * Live arrives at launch and Blizzard runs no PTR for Forever today; each becomes available by filling
 * in its product and build below.
 */
export type GameVersionId = "live" | "ptr" | "beta";

export interface GameVersion {
  id: GameVersionId;
  label: string;
  /** Blizzard's product code; null while none exists. */
  product: string | null;
  /** The build the site's game-file layers come from, "1.60.1.70450"; null while there is none. */
  build: string | null;
  available: boolean;
  /** Why it cannot be chosen yet. */
  note: string | null;
}

const layer = clientLayer.build;

export const GAME_VERSIONS: readonly GameVersion[] = [
  { id: "live", label: "Live", product: null, build: null, available: false, note: `Available at launch, ${LAUNCH.date}` },
  { id: "ptr", label: "PTR", product: null, build: null, available: false, note: "None running" },
  { id: "beta", label: "Beta", product: layer.product, build: layer.version, available: true, note: null },
];

/** The version the site shows its game-file data for: the first available one, in Live, PTR, Beta order. */
export const CURRENT_VERSION: GameVersion = GAME_VERSIONS.find((v) => v.available) ?? GAME_VERSIONS[GAME_VERSIONS.length - 1];

/** "1.60.1" for "1.60.1.70450": the label form; the full string is the build. */
export const shortBuild = (build: string): string => build.split(".").slice(0, 3).join(".");

/** The compact header label, "Build 1.60.1": the build only, so it stays true when Live replaces Beta. */
export const versionLabel = (v: GameVersion = CURRENT_VERSION): string => (v.build ? `Build ${shortBuild(v.build)}` : v.label);
