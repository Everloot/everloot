/**
 * The small Markdown a model writes in a chat answer, read into blocks: paragraphs, bullet and numbered lists,
 * fenced code and pipe tables. Headings come out as plain paragraphs (the system prompt asks for none). Inline,
 * it keeps `code`, **bold**, [text](link) and bare https links; nothing here is ever turned into HTML, so the
 * renderer builds every element itself and no answer text can add markup of its own.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "url"; href: string };

export type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const ROW = /^\s*\|.*\|\s*$/;
const RULE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());

export function blocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const fence = FENCE.exec(line);
    if (fence) {
      // An unclosed fence (a streaming answer midway) runs to the end.
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) body.push(lines[i++]!);
      i++;
      out.push({ kind: "code", lang: fence[1] ?? "", text: body.join("\n") });
      continue;
    }
    if (ROW.test(line) && i + 1 < lines.length && RULE.test(lines[i + 1]!)) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && ROW.test(lines[i]!)) rows.push(cells(lines[i++]!));
      out.push({ kind: "table", head, rows });
      continue;
    }
    const list = BULLET.test(line) ? BULLET : NUMBER.test(line) ? NUMBER : null;
    if (list) {
      const items: string[] = [];
      while (i < lines.length && list.exec(lines[i]!)) items.push(list.exec(lines[i++]!)![1]!);
      out.push({ kind: list === BULLET ? "ul" : "ol", items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !FENCE.test(lines[i]!) && !BULLET.test(lines[i]!) && !NUMBER.test(lines[i]!)
      && !(ROW.test(lines[i]!) && i + 1 < lines.length && RULE.test(lines[i + 1]!))) {
      const l = lines[i++]!;
      para.push(HEADING.exec(l)?.[1] ?? l.trim());
    }
    out.push({ kind: "p", lines: para });
  }
  return out;
}

/** A link a chat answer may open: https, or a path on this site. */
export const safeHref = (href: string) => /^https:\/\/[^\s]+$/.test(href) || /^\/(?![\/\\])/.test(href);

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(https:\/\/[^\s<>()[\]]+)/g;

export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (t: string) => { if (t) out.push({ kind: "text", text: t }); };
  for (const m of text.matchAll(INLINE)) {
    let end = m.index + m[0].length;
    let part: Inline;
    if (m[1] !== undefined) part = { kind: "code", text: m[1] };
    else if (m[2] !== undefined) part = { kind: "strong", text: m[2] };
    else if (m[3] !== undefined) {
      // A link to anywhere else stays as the text it was written as.
      if (!safeHref(m[4]!)) continue;
      part = { kind: "link", text: m[3], href: m[4]! };
    } else {
      // A sentence's closing punctuation is not part of the link.
      const href = m[5]!.replace(/[.,;:!?'"]+$/, "");
      end = m.index + href.length;
      part = { kind: "url", href };
    }
    push(text.slice(last, m.index));
    out.push(part);
    last = end;
  }
  push(text.slice(last));
  return out;
}

/**
 * The answer's first sentence, split from the rest of its first paragraph, as the summary line. Null when the
 * answer is that one sentence alone, or opens with a label rather than a sentence.
 */
export function leadSentence(first: string): { lead: string; rest: string } | null {
  const m = /^(.{12,300}?[.!?])\s+(?=[A-Z0-9*`"[(])([\s\S]+)$/.exec(first);
  return m ? { lead: m[1]!, rest: m[2]! } : null;
}
