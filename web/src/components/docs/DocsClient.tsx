"use client";

import { useEffect, useState, type ReactNode } from "react";
import Card from "@/components/ui/Card";
import CopyButton from "@/components/ui/CopyButton";
import Icon from "@/components/ui/Icon";
import { articleMarkdown } from "@/lib/docs/markdown";

/** Copies the page as Markdown, for pasting into an assistant or an issue. Says when it worked. */
export function CopyPage() {
  const markdown = () => {
    const article = document.querySelector("[data-docs-article]");
    return article ? articleMarkdown(article, window.location.origin) : null;
  };
  return (
    <CopyButton
      text={markdown}
      label="Copy page"
      failedLabel="Copy failed"
      icon={<Icon name="copy" />}
      data-md-skip
      className="btn min-h-9 px-3 text-sm"
      aria-live="polite"
    />
  );
}

interface Heading { id: string; text: string; level: 2 | 3 }

/**
 * "On this page": the article's h2 and h3, read after render, with the section in view marked. Nothing
 * is drawn for a page with fewer than two headings.
 */
export function OnThisPage() {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const found = [...document.querySelectorAll<HTMLElement>("[data-docs-article] h2[id], [data-docs-article] h3[id]")];
    // The heading's own words, without its "#" link.
    const words = (h: HTMLElement) => [...h.childNodes].filter((n) => !(n instanceof HTMLElement && n.hasAttribute("data-md-skip"))).map((n) => n.textContent).join("").trim();
    setHeadings(found.map((h) => ({ id: h.id, text: words(h), level: h.tagName === "H2" ? 2 : 3 })));
    if (!found.length) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setCurrent(visible[0].target.id);
    }, { rootMargin: "-96px 0px -70% 0px" });
    found.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, []);

  if (headings.length < 2) return null;
  return (
    <nav aria-label="On this page" data-md-skip className="text-sm">
      <p className="font-mono text-xs text-muted">On this page</p>
      <ul className="mt-2 border-l border-line">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              aria-current={current === h.id ? "location" : undefined}
              className={`-ml-px flex min-h-9 items-center border-l transition-colors ${h.level === 3 ? "pl-6" : "pl-3"} ${current === h.id ? "border-accent text-accent" : "border-transparent text-fg-2 hover:border-accent hover:text-accent"}`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export interface CodeTab {
  label: string;
  lang: string;
  code: string;
}

/** Tokens for a light, dependency-free highlight: strings, numbers, comments and a few keywords. */
const TOKEN = /(\/\/[^\n]*|#(?![!{])[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b(?:const|let|await|async|function|return|import|from|for|of|in|if|else|def|with|as|print|true|false|null|None|True|False|curl|new)\b)/g;

function highlight(code: string, lang: string) {
  if (lang === "text") return code;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of code.matchAll(TOKEN)) {
    const t = match[0];
    const at = match.index ?? 0;
    // A shell comment needs a space before it; a # inside a URL is not one.
    if (t.startsWith("#") && (lang !== "bash" && lang !== "python" || (at > 0 && !/\s/.test(code[at - 1]!)))) continue;
    if (t.startsWith("//") && lang !== "js" && lang !== "ts") continue;
    parts.push(code.slice(last, at));
    const cls = t.startsWith("//") || t.startsWith("#") ? "text-muted" : /^["'`]/.test(t) ? "text-accent" : /^\d/.test(t) ? "text-warning" : "text-q-rare";
    parts.push(<span key={at} className={cls}>{t}</span>);
    last = at + t.length;
  }
  parts.push(code.slice(last));
  return parts;
}

/**
 * Code in tabs (curl, JavaScript, Python …), each with a copy button. Every tab is in the HTML, so
 * it reads without JavaScript and "Copy page" takes all of them.
 */
export function CodeGroup({ tabs, title, className = "" }: { tabs: CodeTab[]; title?: string; className?: string }) {
  const [active, setActive] = useState(0);
  return (
    <Card padding="none" data-code-block className={`max-w-full ${className}`.trim()}>
      <div data-md-skip className="flex items-center gap-1 border-b border-line px-2">
        {title && <span className="mr-2 px-2 py-2 font-mono text-xs text-muted">{title}</span>}
        <div role="tablist" aria-label={title ?? "Code examples"} className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {tabs.length > 1 ? tabs.map((tab, i) => (
            <button
              key={tab.label}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`-mb-px min-h-9 shrink-0 border-b-2 px-2 text-xs font-medium ${i === active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
            >
              {tab.label}
            </button>
          )) : !title && <span className="px-2 py-2 text-xs font-medium text-muted">{tabs[0]?.label}</span>}
        </div>
        {/* A failed copy says nothing: the code is still selectable. */}
        <CopyButton
          text={tabs[active]!.code}
          label="Copy"
          icon={<Icon name="copy" size={13} />}
          aria-label={`Copy ${tabs[active]?.label ?? "code"}`}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 px-2 text-xs text-muted hover:text-fg"
        />
      </div>
      {tabs.map((tab, i) => (
        <pre
          key={tab.label}
          data-lang={tab.lang}
          data-label={tabs.length > 1 ? tab.label : undefined}
          hidden={i !== active}
          tabIndex={0}
          aria-label={tab.label}
          className="max-h-[32rem] max-w-full overflow-auto whitespace-pre p-4 font-mono text-sm leading-relaxed text-fg [overflow-wrap:normal]"
        >
          {highlight(tab.code, tab.lang)}
        </pre>
      ))}
    </Card>
  );
}

/** On /docs: a link to an anchor of the old /connect page arrives here with its #anchor; send it on. */
export function LegacyAnchors({ targets }: { targets: Record<string, string> }) {
  useEffect(() => {
    const target = targets[decodeURIComponent(window.location.hash.replace(/^#/, ""))];
    if (target) window.location.replace(target);
  }, [targets]);
  return null;
}
