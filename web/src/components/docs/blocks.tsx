import Link from "next/link";
import type { ReactNode } from "react";
import type { DocsIcon as IconName } from "@/lib/docs/nav";
import DocsIcon from "./DocsIcon";

/** The building blocks of a docs page. Server components; the interactive ones are in DocsClient. */

export const docLink = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

function Anchor({ id }: { id: string }) {
  return <a href={`#${id}`} aria-label="Link to this section" data-md-skip className="ml-2 text-muted opacity-0 transition-opacity hover:text-accent focus:opacity-100 group-hover:opacity-100">#</a>;
}

/** A section heading with its own link. Its id feeds "On this page". */
export function H2({ id, children }: { id: string; children: ReactNode }) {
  return <h2 id={id} className="group mt-12 scroll-mt-28 text-xl font-semibold tracking-tight text-fg first:mt-0">{children}<Anchor id={id} /></h2>;
}

export function H3({ id, children }: { id: string; children: ReactNode }) {
  return <h3 id={id} className="group mt-8 scroll-mt-28 text-lg font-semibold tracking-tight text-fg">{children}<Anchor id={id} /></h3>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-4 leading-7 text-fg-2">{children}</p>;
}

export function C({ children }: { children: ReactNode }) {
  return <code className="rounded-[4px] border border-line bg-panel px-1.5 py-0.5 font-mono text-[0.85em] text-fg [overflow-wrap:anywhere]">{children}</code>;
}

export function List({ children, ordered = false }: { children: ReactNode; ordered?: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return <Tag className={`mt-4 space-y-2 pl-6 leading-7 text-fg-2 ${ordered ? "list-decimal" : "list-disc"} marker:text-muted`}>{children}</Tag>;
}

const CALLOUT = {
  note: { label: "Note", box: "border-q-rare/40 bg-q-rare/10", icon: "text-q-rare", path: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11v5M12 8h.01" },
  tip: { label: "Tip", box: "border-accent/40 bg-accent/10", icon: "text-accent", path: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3Z" },
  warning: { label: "Warning", box: "border-warning/40 bg-warning/10", icon: "text-warning", path: "M12 4 2.5 20h19L12 4ZM12 10v4M12 17h.01" },
} as const;

/** A note, tip or warning in a coloured box. The kind is spoken first for screen readers. */
export function Callout({ kind = "note", children }: { kind?: keyof typeof CALLOUT; children: ReactNode }) {
  const c = CALLOUT[kind];
  return (
    <aside className={`mt-6 flex gap-3 rounded-card border p-4 text-sm leading-6 text-fg ${c.box}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={`mt-0.5 shrink-0 ${c.icon}`}><path d={c.path} /></svg>
      <div className="min-w-0 [&>p:first-child]:mt-0 [&_p]:mt-2 [&_p]:text-fg"><span className="sr-only">{c.label}: </span>{children}</div>
    </aside>
  );
}

/** Numbered steps, each with a title and its body (text, code). */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="mt-6 space-y-8 border-l border-line pl-8 [counter-reset:step]">{children}</ol>;
}

export function Step({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <li className="relative [counter-increment:step]">
      <span aria-hidden="true" className="absolute -left-[2.85rem] top-0 flex h-7 w-7 items-center justify-center rounded-full border border-line bg-panel font-mono text-xs text-fg before:content-[counter(step)]" />
      <h3 id={id} className="scroll-mt-28 text-lg font-semibold text-fg">{title}</h3>
      <div className="[&>*:first-child]:mt-2">{children}</div>
    </li>
  );
}

/** Link cards in a grid: the way an overview page sends readers on. */
export function Cards({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={`mt-6 grid gap-4 sm:grid-cols-2 ${cols === 3 ? "lg:grid-cols-3" : ""}`}>{children}</div>;
}

export function LinkCard({ href, title, icon, children }: { href: string; title: string; icon?: IconName; children: ReactNode }) {
  const external = /^https?:/.test(href);
  const body = (
    <>
      {icon && <span className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-control border border-line text-accent"><DocsIcon name={icon} /></span>}
      <span className="block font-semibold text-fg group-hover:text-accent">{title}</span>
      <span className="mt-1 block text-sm leading-6 text-fg-2">{children}</span>
    </>
  );
  const cls = "group block rounded-card border border-line bg-panel p-5 transition-colors hover:border-accent";
  return external ? <a href={href} rel="noopener" className={cls}>{body}</a> : <Link href={href} className={cls}>{body}</Link>;
}

export interface ParamRow { name: string; type: string; required?: boolean; description: ReactNode }

/** Parameters or fields as a list, the way API references show them: name, type, required, what it is. */
export function Params({ rows, empty = "None." }: { rows: ParamRow[]; empty?: string }) {
  if (!rows.length) return <P>{empty}</P>;
  return (
    <dl className="mt-4 divide-y divide-line border-y border-line">
      {rows.map((row) => (
        <div key={row.name} className="py-4">
          <dt className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-sm font-semibold text-accent">{row.name}</code>
            <span className="rounded-[4px] bg-panel px-1.5 font-mono text-xs text-fg-2">{row.type}</span>
            {row.required && <span className="rounded-[4px] bg-danger/10 px-1.5 font-mono text-xs text-danger">required</span>}
          </dt>
          {row.description ? <dd className="mt-2 text-sm leading-6 text-fg-2">{row.description}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/** A plain table for comparisons ("Approach / Best for"). */
export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead><tr className="border-b border-line">{head.map((h) => <th key={h} scope="col" className="py-2 pr-6 font-semibold text-fg">{h}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i} className="border-b border-line">{row.map((cell, j) => <td key={j} className="py-3 pr-6 align-top leading-6 text-fg-2">{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** The method badge and path an endpoint page opens with. */
export function Endpoint({ method, path, base }: { method: "GET" | "POST"; path: string; base: string }) {
  return (
    <div className="mt-6 flex min-w-0 items-center gap-3 rounded-card border border-line bg-panel px-3 py-2.5">
      <span className={`rounded-control px-2 py-0.5 font-mono text-xs font-semibold ${method === "GET" ? "bg-accent/15 text-accent" : "bg-warning/15 text-warning"}`}>{method}</span>
      <code className="min-w-0 truncate font-mono text-sm text-fg" title={`${base}${path}`}><span className="text-muted">{base}</span>{path}</code>
    </div>
  );
}
