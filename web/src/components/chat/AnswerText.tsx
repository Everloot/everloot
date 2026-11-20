import type { ReactNode } from "react";
import { blocks, inline, leadSentence, type Block } from "@/lib/chat/markdown";
import { sourceLink } from "@/lib/chat/agent";

/** An everloot.app page as its path, which says what it is: /database/item/2589. */
export const pagePath = (url: string) => url.replace(/^https:\/\/(?:www\.)?everloot\.app/, "") || "/";
const own = (url: string) => /^https:\/\/(?:www\.)?everloot\.app(?:\/|$)/.test(url);

const KINDS: [RegExp, string][] = [
  [/^\/database\/items?\//, "Item"], [/^\/database\/npcs?\//, "NPC"], [/^\/database\/quests?\//, "Quest"],
  [/^\/database\/objects?\//, "Object"], [/^\/database\/spells?\//, "Spell"], [/^\/database\/zones?\//, "Zone"],
  [/^\/lore\//, "Lore"], [/^\/changes(?:\/|$)/, "Change"], [/^\/tools\//, "Tool"],
];
/** What an Everloot page is, from its path: Item, NPC, Quest… */
export const pageKind = (path: string) => KINDS.find(([re]) => re.test(path))?.[1] ?? "Page";

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const chip = "mx-0.5 inline-flex max-w-full items-baseline gap-1 rounded-full border border-line bg-panel px-2 align-baseline text-xs leading-5 text-fg-2 transition-colors hover:border-accent";

/**
 * A link the model wrote next to a claim, as a source chip: an Everloot page by its kind and path, a cited page by
 * its site and path. Cited pages open in a new tab.
 */
function SourceChip({ href }: { href: string }) {
  if (own(href)) {
    const path = pagePath(href);
    return (
      <a href={path} className={chip} data-source-chip>
        <span className="font-mono text-muted">{pageKind(path)}</span><span className="min-w-0 truncate">{path}</span>
      </a>
    );
  }
  const label = sourceLink(href)?.label ?? href;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={chip} data-source-chip>
      <span className="font-mono text-muted">Cited<span className="sr-only"> (opens in a new tab)</span></span><span className="min-w-0 truncate">{label}</span>
    </a>
  );
}

function Inline({ text }: { text: string }) {
  return inline(text).map((part, i) => {
    switch (part.kind) {
      case "code": return <code key={i} className="rounded-control bg-panel px-1 font-mono text-[0.9em] text-fg">{part.text}</code>;
      case "strong": return <strong key={i} className="font-semibold text-fg">{part.text}</strong>;
      case "link": return own(part.href) || part.href.startsWith("/")
        ? <a key={i} href={own(part.href) ? pagePath(part.href) : part.href} className={link}>{part.text}</a>
        : <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className={link}>{part.text}<span className="sr-only"> (opens in a new tab)</span></a>;
      case "url": return <SourceChip key={i} href={part.href} />;
      default: return part.text;
    }
  });
}

function Lines({ lines }: { lines: string[] }) {
  return lines.map((l, i) => <span key={i}>{i > 0 && <br />}<Inline text={l} /></span>);
}

function BlockView({ b }: { b: Block }): ReactNode {
  switch (b.kind) {
    case "p": return <p><Lines lines={b.lines} /></p>;
    case "ul": return <ul className="list-disc space-y-1 pl-6">{b.items.map((t, i) => <li key={i}><Inline text={t} /></li>)}</ul>;
    case "ol": return <ol className="list-decimal space-y-1 pl-6">{b.items.map((t, i) => <li key={i}><Inline text={t} /></li>)}</ol>;
    case "code": return (
      <pre data-lang={b.lang || undefined} className="overflow-x-auto rounded-control border border-line bg-panel p-3 font-mono text-sm leading-6 text-fg"><code>{b.text}</code></pre>
    );
    case "table": return (
      // A wide table scrolls inside its own box, so a phone's page never scrolls sideways.
      <div className="overflow-x-auto rounded-control border border-line">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-panel text-fg">
            <tr>{b.head.map((h, i) => <th key={i} scope="col" className="border-b border-line px-3 py-2 font-semibold"><Inline text={h} /></th>)}</tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-b-0">
                {b.head.map((_, j) => <td key={j} className="px-3 py-2 align-top"><Inline text={r[j] ?? ""} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
}

/**
 * A model's answer at reading size (16 px, 1.6 line height), with its Markdown drawn and the links next to its
 * claims as source chips. With `summary`, the answer's first sentence stands on its own line as the summary.
 */
export default function AnswerText({ text, summary = false }: { text: string; summary?: boolean }) {
  const all = blocks(text);
  const first = all[0];
  // The first sentence leads when more follows it: the rest of its paragraph, or a one-line paragraph before more blocks.
  const opening = summary && first?.kind === "p" ? first.lines.join("\n") : null;
  const split = opening === null ? null
    : leadSentence(opening) ?? (all.length > 1 && first!.kind === "p" && first!.lines.length === 1 ? { lead: opening, rest: "" } : null);
  const shown: Block[] = split ? [...(split.rest ? [{ kind: "p" as const, lines: split.rest.split("\n") }] : []), ...all.slice(1)] : all;
  return (
    <div data-answer className="min-w-0 space-y-4 break-words text-base leading-[1.6] text-fg">
      {split && <p data-summary className="font-medium"><Inline text={split.lead} /></p>}
      {shown.map((b, i) => <BlockView key={i} b={b} />)}
    </div>
  );
}
