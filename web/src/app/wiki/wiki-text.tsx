import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { tokenKey, type TokenTarget } from "@/lib/wiki-names";
import { wikiHref, type Block, type Inline, type WikiPage } from "@/lib/wiki";
import { MARKDOWN_LINK, wikiLinkTarget } from "../../../../kb/src/wiki/page";

/**
 * What a page needs to draw its text: the entity tokens' names and links, and the pages a `[[slug]]` or a Markdown
 * link into the wiki may link to.
 */
export interface TextContext {
  tokens: Map<string, TokenTarget>;
  pages: (slug: string) => WikiPage | null;
  /** Whether a Markdown link may be drawn; one that may not stands as its words alone. A guide's page refuses links
   *  to guides that are not published. Without it, every link is drawn but one to a wiki page that is not published. */
  linkable?: (href: string) => boolean;
}

// The Markdown a text run may carry: [text](an https address or a /path), **bold**, *emphasis* or _emphasis_. The link
// form is the page check's, so the check reads every link this draws.
const MARKS = new RegExp(String.raw`${MARKDOWN_LINK.source}|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\b_([^_\n]+)_\b`, "g");

function marked(text: string, key: string, ctx: TextContext): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKS)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}.${m.index}`;
    // A link into the wiki is drawn only to a published page; to any other its words stand alone, as a [[slug]]'s do.
    // So is a link the page refuses.
    const slug = m[1] ? wikiLinkTarget(m[2]) : null;
    if ((slug !== null && !ctx.pages(slug)) || (m[1] && ctx.linkable && !ctx.linkable(m[2]))) out.push(m[1]);
    else if (m[1]) out.push(m[2].startsWith("/") ? <Link key={k} href={m[2]}>{m[1]}</Link> : <a key={k} href={m[2]} rel="noopener">{m[1]}</a>);
    else if (m[3]) out.push(<strong key={k}>{m[3]}</strong>);
    else out.push(<em key={k}>{m[4] ?? m[5]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function InlineText({ inline, ctx }: { inline: Inline[]; ctx: TextContext }) {
  return (
    <>
      {inline.map((t, i) => {
        if (t.kind === "text") return <Fragment key={i}>{marked(t.text, String(i), ctx)}</Fragment>;
        if (t.kind === "entity") {
          const target = ctx.tokens.get(tokenKey(t.entity, t.id));
          if (!target) return null;
          return target.href ? <Link key={i} href={target.href} data-wiki-token={tokenKey(t.entity, t.id)}>{target.name}</Link> : <span key={i}>{target.name}</span>;
        }
        const page = ctx.pages(t.slug);
        return page ? <Link key={i} href={wikiHref(page.slug)} data-wiki-link={page.slug}>{page.title}</Link> : <span key={i}>{t.slug.replace(/-/g, " ")}</span>;
      })}
    </>
  );
}

export function WikiBlock({ block, ctx }: { block: Block; ctx: TextContext }) {
  switch (block.type) {
    case "heading":
      return <h3 className="text-base font-semibold text-fg">{block.text}</h3>;
    case "quote":
      return <blockquote className="border-l-2 border-line pl-4"><InlineText inline={block.inline} ctx={ctx} /></blockquote>;
    case "list":
      return <ul>{block.items.map((item, i) => <li key={i}><InlineText inline={item} ctx={ctx} /></li>)}</ul>;
    default:
      return <p><InlineText inline={block.inline} ctx={ctx} /></p>;
  }
}
