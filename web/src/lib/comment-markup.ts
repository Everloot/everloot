/**
 * The little markup a comment may use, read into a tree the page draws with React, so a comment's words are always text
 * and never HTML: paragraphs (a blank line), line breaks, **bold**, *italic*, `code`, ||spoilers|| and links. A link is
 * [words](address) or a bare https address, and only to this site or the WoW sites in COMMENT_LINK_HOSTS. Any other
 * address stays text and is listed in `rejected`, which the server refuses a comment for. There are no images.
 */

/** Where a comment may link, each with its subdomains: the site itself and a short list of well-known WoW sites. */
export const COMMENT_LINK_HOSTS = [
  "everloot.app", "worldofwarcraft.blizzard.com", "news.blizzard.com", "us.forums.blizzard.com", "eu.forums.blizzard.com",
  "wowhead.com", "warcraft.wiki.gg", "curseforge.com",
] as const;

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "br" }
  | { kind: "strong" | "em" | "spoiler"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] };
export type Block = Inline[];

const SITE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~/?#=&%+:@!$,;]*$/;

/** The address a comment may link to, as the link will carry it, or null. A path on this site stays a path. */
export function commentHref(raw: string): string | null {
  if (!raw || raw.length > 500 || raw !== raw.trim()) return null;
  if (raw.startsWith("/")) return SITE_PATH.test(raw) ? raw : null;
  if (/[\\\s]/.test(raw) || !/^https:\/\//i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  return COMMENT_LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? url.href : null;
}

const LINK = /^\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/;
const BARE = /^https?:\/\/[^\s<>()[\]|`*"']+/i;
const TRAILING = /[.,;:!?]+$/;

/** One line's inline markup. A spoiler holds no spoiler; code holds nothing but its text. */
function inline(line: string, rejected: string[], inSpoiler = false): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ kind: "text", text });
    text = "";
  };
  // A pair closes when its end comes later on the line around words that do not start or end with a space.
  const pair = (at: number, mark: string): string | null => {
    const end = line.indexOf(mark, at + mark.length);
    if (end < 0) return null;
    const inner = line.slice(at + mark.length, end);
    return inner && inner === inner.trim() ? inner : null;
  };
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    const ch = line[i];
    let inner: string | null;
    if (ch === "`" && (inner = pair(i, "`")) !== null) {
      flush();
      out.push({ kind: "code", text: inner });
      i += inner.length + 2;
    } else if (rest.startsWith("||") && !inSpoiler && (inner = pair(i, "||")) !== null) {
      flush();
      out.push({ kind: "spoiler", children: inline(inner, rejected, true) });
      i += inner.length + 4;
    } else if (rest.startsWith("**") && (inner = pair(i, "**")) !== null) {
      flush();
      out.push({ kind: "strong", children: inline(inner, rejected, inSpoiler) });
      i += inner.length + 4;
    } else if (ch === "*" && !rest.startsWith("**") && (inner = pair(i, "*")) !== null && !inner.startsWith("*")) {
      flush();
      out.push({ kind: "em", children: inline(inner, rejected, inSpoiler) });
      i += inner.length + 2;
    } else if (ch === "[" && LINK.test(rest)) {
      const [whole, words, address] = rest.match(LINK)!;
      const href = commentHref(address);
      if (href) {
        flush();
        out.push({ kind: "link", href, children: [{ kind: "text", text: words }] });
      } else {
        rejected.push(address);
        text += whole;
      }
      i += whole.length;
    } else if ((ch === "h" || ch === "H") && !/[A-Za-z0-9]/.test(line[i - 1] ?? "") && BARE.test(rest)) {
      const address = rest.match(BARE)![0].replace(TRAILING, "");
      const href = commentHref(address);
      if (href) {
        flush();
        out.push({ kind: "link", href, children: [{ kind: "text", text: address }] });
      } else {
        rejected.push(address);
        text += address;
      }
      i += address.length;
    } else {
      text += ch;
      i += 1;
    }
  }
  flush();
  return out;
}

/** A comment's words as paragraphs of inline markup, and the addresses it links that a comment may not. */
export function parseComment(body: string): { blocks: Block[]; rejected: string[] } {
  const rejected: string[] = [];
  const blocks = body
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.replace(/^\n+|\n+$/g, ""))
    .filter((paragraph) => paragraph.trim() !== "")
    .map((paragraph) => paragraph.split("\n").flatMap((line, n): Inline[] => (n ? [{ kind: "br" }, ...inline(line, rejected)] : inline(line, rejected))));
  return { blocks, rejected };
}
