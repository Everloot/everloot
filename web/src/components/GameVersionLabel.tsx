import Link from "@/components/Link";
import { CURRENT_VERSION } from "@/lib/game-version";
import buildsFile from "../../../kb/changes/builds.json";

const newest = buildsFile.builds.filter((b) => b.product === CURRENT_VERSION.product)
  .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen))[0];

/** The file extraction and the build watch describe different reads, even when their builds match. */
/** `linkClassName` adds to both links, e.g. the footer's phone touch area. */
export default function GameVersionLabel({ className = "", linkClassName = "" }: { className?: string; linkClassName?: string }) {
  const version = CURRENT_VERSION.build;
  return (
    <div className={className}>
      <div className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-panel px-3 py-1 text-xs text-fg-2">
        <Link href={version ? `/changes?show=builds&q=${version}` : "/methodology#files"} title={`The game files Everloot reads: build ${version ?? "unknown"}.`} className={`hover:text-fg hover:underline ${linkClassName}`}>files read {version?.split(".").at(-1) ?? "unknown"}</Link>
        {" \u00b7 "}
        <Link href="/changes" title={`The newest WoW: Forever build first seen by Everloot${newest ? `: ${newest.version} on ${newest.firstSeen.slice(0, 10)}` : ": none recorded"}.`} className={`hover:text-fg hover:underline ${linkClassName}`}>newest seen {newest?.buildId ?? "unknown"}</Link>
      </div>
    </div>
  );
}
