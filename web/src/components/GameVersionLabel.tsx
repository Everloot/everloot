import Link from "next/link";
import { CURRENT_VERSION } from "@/lib/game-version";
import buildsFile from "../../../kb/changes/builds.json";

const newest = buildsFile.builds.filter((b) => b.product === CURRENT_VERSION.product)
  .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen))[0];

/** The file extraction and the build watch describe different reads, even when their builds match. */
export default function GameVersionLabel({ className = "" }: { className?: string }) {
  const version = CURRENT_VERSION.build;
  return (
    <div className={`whitespace-nowrap font-mono text-xs text-fg-2 ${className}`}>
      <Link href={version ? `/changes?show=builds&q=${version}` : "/methodology#files"} title={`The game files Everloot reads: build ${version ?? "unknown"}.`} className="hover:text-fg hover:underline">files read {version?.split(".").at(-1) ?? "unknown"}</Link>
      {" \u00b7 "}
      <Link href="/changes" title={`The newest WoW: Forever build first seen by Everloot${newest ? `: ${newest.version} on ${newest.firstSeen.slice(0, 10)}` : ": none recorded"}.`} className="hover:text-fg hover:underline">newest seen {newest?.buildId ?? "unknown"}</Link>
    </div>
  );
}
