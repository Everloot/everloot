"use client";

import { useState, type ReactNode } from "react";
import { parseComment, type Inline } from "@/lib/comment-markup";

const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

/** A spoiler: a button until the reader opens it, so its words are not on the page, read aloud or found by search before. */
function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return open
    ? <span className="rounded-control bg-panel px-1">{children}</span>
    : (
      <button type="button" aria-expanded={false} onClick={() => setOpen(true)}
        className="rounded-control border border-edge bg-panel px-2 text-sm text-fg-2 hover:text-fg">
        Show spoiler
      </button>
    );
}

function draw(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case "text": return n.text;
      case "br": return <br key={i} />;
      case "code": return <code key={i} className="rounded-control bg-panel px-1 font-mono text-sm">{n.text}</code>;
      case "strong": return <strong key={i}>{draw(n.children)}</strong>;
      case "em": return <em key={i}>{draw(n.children)}</em>;
      case "spoiler": return <Spoiler key={i}>{draw(n.children)}</Spoiler>;
      // Only addresses commentHref allowed reach here. ugc and nofollow: a comment's link is not the site's endorsement.
      case "link": return <a key={i} href={n.href} rel="ugc nofollow noopener noreferrer" className={LINK}>{draw(n.children)}</a>;
    }
  });
}

/** A comment's words, drawn from its markup as React elements: text is always text, never HTML. */
export default function CommentBody({ body }: { body: string }) {
  const { blocks } = parseComment(body);
  return (
    <div className="space-y-2 break-words text-fg">
      {blocks.map((block, i) => <p key={i}>{draw(block)}</p>)}
    </div>
  );
}
