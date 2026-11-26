import build from "@/data/game-data/build-version.json";
import { REPO_URL } from "./source";

/** What a database page tells the report form about itself: its type as the page names it, its id and its path. */
export interface WrongDataReport { type: string; id: number | string; path: string; build?: string }

/**
 * The repository's Wrong data issue form (.github/ISSUE_TEMPLATE/wrong-data.yml), the path docs/guides/report-wrong-data
 * already sends players to, with the page filled in: the type, id and build in the title, the page URL in its "Everloot
 * page" field. Nothing is sent from the site; the player writes the rest on GitHub and posts it themselves.
 */
export function wrongDataUrl({ type, id, path, build: shown = build.version }: WrongDataReport): string {
  const query = new URLSearchParams({ template: "wrong-data.yml", title: `Wrong data: ${type} ${id} (build ${shown})`, link: `https://everloot.app${path}` });
  return `${REPO_URL}/issues/new?${query}`;
}
