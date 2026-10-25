import type { ReactNode } from "react";
import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import GameIcon from "@/components/game/GameIcon";
import { AgreementMeter, GET_THE_ADDON, QUALITY_TEXT, type Quality } from "@/components/ui";
import { UNCONFIRMED_TITLE } from "@/components/ui/Badge";
import { trailFor } from "@/lib/breadcrumbs";
import { breadcrumbJsonLd, type Crumb } from "@/lib/jsonld";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";

// The layout every database entity page shares (item, NPC, quest, object, vendor), read like an item
// database: a compact title with its type line, the tooltip box and the quick facts side by side,
// then full-width tabs of dense tables. Stacked on a phone. No breadcrumb on screen: the trail is
// only the BreadcrumbList JSON-LD.

/**
 * The quiet "unconfirmed" marker as an edge: a 1 px dashed frame around what it wraps (the header icon),
 * with the tooltip and sr-only text of the `files` Badge. Never a chip or a sentence.
 */
export function Unconfirmed({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span data-unconfirmed title={UNCONFIRMED_TITLE} className={`inline-flex rounded-[3px] border border-dashed border-edge ${className}`.trim()}>
      {children}
      <span className="sr-only"> unconfirmed</span>
    </span>
  );
}

/** The header's icon: the game icon, or an empty frame of the same size when there is none to show. */
export function EntityIcon({ src, unconfirmed = false }: { src?: string | null; unconfirmed?: boolean }) {
  const icon = src
    ? <GameIcon src={src} size={40} className="rounded-[3px]" />
    : <span aria-hidden="true" className="block h-10 w-10 rounded-[3px] bg-panel" />;
  return unconfirmed ? <Unconfirmed className="shrink-0 p-px">{icon}</Unconfirmed> : <span className="shrink-0">{icon}</span>;
}

/**
 * The page title: an optional icon, the name (in its quality colour for items) and one 13 px type line
 * ("Trade Goods · Cloth · ID 2589"). The trail feeds the BreadcrumbList JSON-LD only; the layout already
 * emits it for routes lib/breadcrumbs.ts knows, so it is emitted here only for the others.
 */
export function EntityHeader({ trail, title, quality, icon, meta = [] }: {
  trail: Crumb[]; title: ReactNode; quality?: Quality; icon?: ReactNode; meta?: ReactNode[];
}) {
  const page = trail[trail.length - 1];
  const emitJsonLd = trail.length > 1 && page && !trailFor(page.path);
  const parts = meta.filter((m) => m !== null && m !== undefined && m !== false && m !== "");
  return (
    <header data-page-header className="mb-4 flex min-w-0 items-center gap-3">
      {emitJsonLd && <JsonLd data={breadcrumbJsonLd(trail)} />}
      {icon}
      <div className="min-w-0">
        <h1 className={`text-title-sm [overflow-wrap:anywhere] sm:text-title ${quality ? QUALITY_TEXT[quality] : "text-fg"}`}>{title}</h1>
        {parts.length > 0 && (
          <p data-entity-meta className="text-meta text-muted">
            {parts.map((part, i) => <span key={i}>{i > 0 && <span aria-hidden="true"> · </span>}{part}</span>)}
          </p>
        )}
      </div>
    </header>
  );
}

/**
 * The top band: the tooltip box (or a map thumbnail) at left, the quick facts beside it (two 280 px columns
 * of them on a wide screen, so the band stays short); stacked on a phone.
 */
export function EntityTop({ box, facts }: { box: ReactNode; facts: ReactNode }) {
  return (
    <div className="mb-6 grid items-start gap-4 sm:grid-cols-[minmax(0,320px)_minmax(0,280px)] sm:gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,584px)]">
      <div className="min-w-0">{box}</div>
      <section aria-label="Quick facts" className="min-w-0">{facts}</section>
    </div>
  );
}

/** A quick fact's value, or the empty agreement meter while no install has reported it. */
export const known = (value: ReactNode) => (value === null || value === undefined || value === "" ? <AgreementMeter count={0} /> : value);

/**
 * An empty tab: one line. The agreement meter and "Get the addon" for what players report; a plain line
 * (and its own link, if any) for what the game files would give.
 */
export function EmptyTab({ message, players = true, action = GET_THE_ADDON }: { message: string; players?: boolean; action?: { href: string; label: string } | null }) {
  return (
    <p data-empty-state className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-meta text-fg-2">
      {players && <AgreementMeter count={0} />}
      <span>{message}</span>
      {action && <Link href={action.href} className={LINK}>{action.label}</Link>}
    </p>
  );
}

/** What a player-data tab says when storage cannot be read: unrecorded, never zero. */
export function Unreachable() {
  return <p className="py-3 text-meta text-fg-2">{STORAGE_UNREACHABLE}</p>;
}

/** An observed frequency as a percentage with one decimal. */
export const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`;

/** The header of a frequency column; what a loot window is goes in its tooltip, not in a sentence under the table. */
export const FREQUENCY = <span title="A loot window is a recorded loot, not a verified kill, so a frequency is not a drop chance.">Observed frequency</span>;

/** The shared link style for a name in a table. */
export const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
