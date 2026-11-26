import CopyButton from "@/components/ui/CopyButton";
import { wrongDataUrl, type WrongDataReport } from "@/lib/report-wrong-data";

/**
 * The open-data row under a page's summary: the record as plain text for an assistant to read, and
 * the same record as JSON. Both are public and already served; this only makes them reachable from
 * the page they describe. A database entity page passes `report` for its Report wrong data link.
 */
export default function OpenData({ text, jsonHref, report, className = "" }: { text: string; jsonHref?: string; report?: WrongDataReport; className?: string }) {
  return (
    <p className={`mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-fg-2 ${className}`}>
      <CopyButton label="Copy for AI" text={text} />
      {jsonHref ? (
        <a href={jsonHref} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">
          Raw JSON
        </a>
      ) : null}
      {report ? (
        <a href={wrongDataUrl(report)} target="_blank" rel="noopener noreferrer" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">
          Report wrong data
        </a>
      ) : null}
    </p>
  );
}
