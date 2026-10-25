import { answerOrigin, NO_SOURCED_ANSWER, sourceLink } from "@/lib/chat/agent";
import type { ChatMessage } from "@/lib/chat/store";
import ItemResult from "./ItemResult";

const link = "underline underline-offset-4 hover:text-accent break-all";

/** An everloot.app page as its path, which says what it is: /database/item/2589. */
const pagePath = (url: string) => url.replace(/^https:\/\/(?:www\.)?everloot\.app/, "") || "/";

/** Search-only replies are the tools' raw hits; their Source and More lines are shown as links instead. */
function shownText(m: ChatMessage): string {
  if (m.model) return m.text;
  return m.text.split("\n").filter((l) => !/^(?:Source|More):\s/.test(l.trim())).join("\n").trim();
}

export function UserMessage({ m }: { m: ChatMessage }) {
  return (
    <div className="ml-auto w-fit max-w-[85%] rounded-card border border-line bg-panel px-4 py-2">
      <p className="whitespace-pre-wrap break-words text-fg">{m.text}</p>
      {m.context && <p className="mt-1 text-xs text-muted">{m.context}</p>}
    </div>
  );
}

/** An answer, its item, its origin (From Everloot with the pages, From the model), the model and a copy button. */
export function AssistantMessage({ m, copied, onCopy, onChoose = () => {} }: { m: ChatMessage; copied: boolean; onCopy: () => void; onChoose?: (id: number) => void }) {
  const origin = answerOrigin(m);
  // Without a model an item answer is the database's card alone.
  const everloot = origin.everloot || (!m.model && m.item !== undefined && "id" in m.item);
  const pages = m.pages ?? [];
  const cited = m.sources.flatMap((s) => {
    const l = sourceLink(s);
    return l && !pages.includes(l.href) ? [l] : [];
  });
  return (
    <div className="space-y-2">
      <div className="whitespace-pre-wrap break-words leading-7 text-fg">{shownText(m)}</div>
      {m.item && <ItemResult item={m.item} onChoose={onChoose} />}
      {everloot && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-fg-2">
          <span className="rounded-full border border-accent px-2 text-accent">From Everloot</span>
          {pages.map((p) => <a key={p} href={p} className={link}>{pagePath(p)}</a>)}
          {cited.length > 0 && (
            <span>
              Cited:{" "}
              {cited.map((c, i) => (
                <span key={c.href}>{i > 0 && ", "}<a href={c.href} target="_blank" rel="noopener noreferrer" className={link}>{c.label}</a></span>
              ))}
            </span>
          )}
        </div>
      )}
      {origin.model && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-fg-2">
          <span className="rounded-full border border-edge px-2">From the model</span>
          <span className="text-muted">{origin.everloot ? "Part of this is the model's own knowledge, not Everloot's data." : "Everloot had nothing on this, so the model answered from what it knows."}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
        <span>{m.model ?? "Everloot search"}</span>
        {m.steps.length > 0 && <span>{m.steps.length} lookup{m.steps.length === 1 ? "" : "s"}</span>}
        {m.text !== NO_SOURCED_ANSWER && (
          <button type="button" className="min-h-9 underline underline-offset-4 hover:text-accent" onClick={onCopy}>{copied ? "Copied" : "Copy"}</button>
        )}
      </div>
    </div>
  );
}
