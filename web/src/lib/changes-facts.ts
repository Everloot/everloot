import type { ChangeEntry } from "./changes";
import { utcDay } from "./time";

/** The newest WoW: Forever build Everloot has seen, or null when none is recorded. Entries are newest first. */
export function latestForeverBuild(entries: ChangeEntry[]): ChangeEntry | null {
  return entries.find((e) => e.type === "build" && e.game === "forever") ?? null;
}

/** "Latest build: ..." in the words /changes and /wow-forever both use. A build's date is when Everloot first saw it. */
export function latestBuildLine(entries: ChangeEntry[]): string {
  const build = latestForeverBuild(entries);
  if (!build?.version) return "No WoW: Forever build is recorded yet.";
  return `Latest build: WoW: Forever ${build.version}, first seen by Everloot on ${utcDay(build.at) ?? build.at.slice(0, 10)}.`;
}
