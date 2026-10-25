import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CLASSES, QUALITIES, RADIUS, SPACE, tokens, WIDTH, type TokenName } from "@/design/tokens";
import {
  AgreementMeter, Badge, Card, Container, DataTable, EmptyState, PageHeader, SectionHeading, Tabs, TooltipFrame,
  QUALITY_TEXT, qualityOf, type Column,
} from "@/components/ui";

// Every token and component of the design system in its states, for visual review. Not linked from
// the site, not in the sitemap, and kept out of search results.
export const metadata: Metadata = {
  title: "Design system",
  description: "Everloot's tokens and components in every state, for review.",
  robots: { index: false, follow: false },
};

const SURFACE: TokenName[] = ["canvas", "panel", "line", "edge", "fg", "fg-2", "muted", "accent", "danger", "warning", "tooltip", "tooltip-border", "tooltip-inner"];

function Swatch({ name }: { name: TokenName }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <span aria-hidden="true" className="h-6 w-6 shrink-0 rounded-control border border-line" style={{ background: tokens.dark[name] }} />
      <span className="font-mono text-sm text-fg">{name}</span>
      <span className="ml-auto font-mono text-xs tabular-nums text-muted">{tokens.dark[name]}</span>
    </li>
  );
}

function Specimen({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-line pt-8 first:border-t-0 first:pt-0">
      <SectionHeading id={id} note={note}>{title}</SectionHeading>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-2 font-mono text-xs text-muted">{children}</p>;
}

/** A square standing in for a game icon, so the page needs no asset bucket. */
function IconStandIn({ quality, size = 48 }: { quality: (typeof QUALITIES)[number]; size?: number }) {
  return <span aria-hidden="true" className={`block rounded-control border-2 border-current bg-canvas ${QUALITY_TEXT[quality]}`} style={{ width: size, height: size }} />;
}

type Row = { id: number; name: string; quality: number; kind: string; zone: string; seen: number; installs: number; price: string };
const ROWS: Row[] = [
  { id: 2589, name: "Linen Cloth", quality: 1, kind: "Trade goods", zone: "Elwynn Forest", seen: 1204, installs: 3, price: "0s 13c" },
  { id: 7960, name: "Truesilver Champion", quality: 3, kind: "Two-hand sword", zone: "Crafted", seen: 2, installs: 1, price: "-" },
  { id: 19019, name: "Thunderfury, Blessed Blade of the Windseeker", quality: 5, kind: "One-hand sword", zone: "Molten Core", seen: 0, installs: 0, price: "-" },
  { id: 4306, name: "Silk Cloth", quality: 1, kind: "Trade goods", zone: "Stranglethorn Vale", seen: 410, installs: 2, price: "1s 2c" },
  { id: 3864, name: "Citrine", quality: 2, kind: "Gem", zone: "Badlands", seen: 17, installs: 1, price: "-" },
  { id: 12360, name: "Arcanite Bar", quality: 4, kind: "Trade goods", zone: "Transmuted", seen: 1, installs: 0, price: "-" },
  { id: 117, name: "Tough Jerky", quality: 0, kind: "Food", zone: "Vendors everywhere", seen: 66, installs: 2, price: "0s 25c" },
];

const COLUMNS: Column<Row>[] = [
  { key: "name", header: "Item", sortable: true, cell: (r) => <a href={`/database/items/${r.id}`} className={`hover:underline underline-offset-4 ${QUALITY_TEXT[qualityOf(r.quality)]}`}>{r.name}</a> },
  { key: "kind", header: "Type", cell: (r) => <span className="text-fg-2">{r.kind}</span>, nowrap: true },
  { key: "zone", header: "Zone", cell: (r) => <span className="text-fg-2">{r.zone}</span>, nowrap: true },
  { key: "id", header: "Item ID", numeric: true, sortable: true, cell: (r) => r.id },
  { key: "seen", header: "Loot windows", numeric: true, sortable: true, cell: (r) => r.seen.toLocaleString("en-US") },
  { key: "installs", header: "Installs", cell: (r) => <AgreementMeter count={r.installs} />, nowrap: true },
  { key: "price", header: "Vendor price", numeric: true, cell: (r) => r.price },
];

export default function DesignSystemPage() {
  return (
    <Container>
      <PageHeader
        title="Design system"
        lede="Every token and component, in every state. For review; not part of the site."
        meta={<><Badge tone="neutral">Dark only</Badge><span className="font-mono">reading {WIDTH.reading} · wide {WIDTH.wide}</span></>}
      />

      <div className="space-y-12">
        <Specimen id="colour" title="Colour" note="Dark only. The light values stay in tokens.ts for later.">
          <div className="grid gap-x-12 gap-y-6 md:grid-cols-2">
            <div>
              <Label>Surface and text</Label>
              <ul className="divide-y divide-line">{SURFACE.map((name) => <Swatch key={name} name={name} />)}</ul>
            </div>
            <div className="space-y-6">
              <div>
                <Label>Item quality</Label>
                <ul className="divide-y divide-line">{QUALITIES.map((q) => <Swatch key={q} name={`q-${q}`} />)}</ul>
              </div>
              <div>
                <Label>Class and chat</Label>
                <ul className="divide-y divide-line">
                  {CLASSES.map((c) => <Swatch key={c} name={`class-${c}`} />)}
                  <Swatch name="chat-whisper" />
                  <Swatch name="chat-guild" />
                </ul>
              </div>
            </div>
          </div>
        </Specimen>

        <Specimen id="type" title="Type" note="Geist for reading, Geist Mono for numbers, ids and builds.">
          <div className="space-y-4">
            <p className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">Page title, 36 px (30 px on a phone)</p>
            <p className="text-xl font-semibold tracking-tight text-fg">Section heading, 20 px</p>
            <p className="max-w-[65ch] text-lg text-fg-2">Lede, 18 px: one line that says what the page is.</p>
            <p className="max-w-[65ch] text-fg">Body, 16 px. A number comes with its denominator and its date: 3 of 3 installs, 2026-10-19.</p>
            <p className="text-sm text-muted">Small, 14 px, muted: notes and table text.</p>
            <p className="font-mono text-sm tabular-nums text-fg-2">Mono 14 px · build 1.60.1.70450 · item 19019 · 31,849</p>
          </div>
        </Specimen>

        <Specimen id="space" title="Spacing, corners and widths">
          <div>
            <Label>Spacing scale (px)</Label>
            <ul className="space-y-2">
              {SPACE.map((px) => (
                <li key={px} className="flex items-center gap-4">
                  <span className="w-8 text-right font-mono text-xs tabular-nums text-muted">{px}</span>
                  <span aria-hidden="true" className="block h-3 rounded-sm bg-accent" style={{ width: px * 3 }} />
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap items-end gap-6">
            <div><Label>control {RADIUS.control}px</Label><span aria-hidden="true" className="block h-12 w-20 rounded-control border border-edge" /></div>
            <div><Label>card {RADIUS.card}px</Label><span aria-hidden="true" className="block h-12 w-32 rounded-card border border-edge" /></div>
            <div><Label>pill</Label><span aria-hidden="true" className="block h-8 w-28 rounded-full border border-edge" /></div>
          </div>
          <div className="space-y-2">
            <Label>Content widths</Label>
            <Container width="reading"><div className="rounded-control border border-dashed border-edge px-4 py-2 font-mono text-xs text-muted">reading, {WIDTH.reading} px: documents, legal pages, about</div></Container>
            <Container width="wide"><div className="rounded-control border border-dashed border-edge px-4 py-2 font-mono text-xs text-muted">wide, {WIDTH.wide} px: data, tables, tools, the header and footer</div></Container>
          </div>
        </Specimen>

        <Specimen id="buttons" title="Buttons and links" note="Primary: filled fel green, one per view. Secondary: the outline pill.">
          <div className="flex flex-wrap items-center gap-3">
            <a href="/addon" className="btn btn-primary">Get the addon</a>
            <a href="/methodology" className="btn">How we count</a>
            <a href="/addon" className="btn btn-primary min-h-10 px-4 text-sm">Small primary</a>
            <button type="button" className="btn btn-primary" disabled>Disabled primary</button>
            <button type="button" className="btn" disabled>Disabled</button>
            <a href="/database" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">A text link</a>
          </div>
        </Specimen>

        <Specimen id="page-header" title="PageHeader" note="One per page. One compact title size, one-line lede, then meta and actions. No visible breadcrumb.">
          <Card>
            <PageHeader
              title="Linen Cloth"
              quality="common"
              icon={<IconStandIn quality="common" />}
              trail={[{ name: "Home", path: "/" }, { name: "Database", path: "/database" }, { name: "Items", path: "/database/items" }, { name: "Linen Cloth", path: "/database/items/2589" }]}
              meta={<><Badge tone="files" /><span className="font-mono tabular-nums">Item 2589</span><AgreementMeter count={0} withText /></>}
              actions={<a href="#page-header" className="btn">Copy link</a>}
            />
          </Card>
          <Card>
            <PageHeader
              title="Thunderfury, Blessed Blade of the Windseeker"
              quality="legendary"
              icon={<IconStandIn quality="legendary" />}
              lede="A long name wraps; it never pushes the page sideways."
              meta={<><Badge tone="quality" quality="legendary" /><Badge tone="files" /></>}
            />
          </Card>
          <Card>
            <PageHeader title="Talent calculator" lede="Plan a build for any class and share it with its game build attached." actions={<><a href="#page-header" className="btn">Reset</a><a href="#page-header" className="btn btn-primary">Share</a></>} />
          </Card>
        </Specimen>

        <Specimen id="section-heading" title="SectionHeading" note="One style. An action at the right, at most one line under it.">
          <Card>
            <SectionHeading as="h3" action={<a href="#section-heading" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">All recipes →</a>}>Used in</SectionHeading>
            <SectionHeading as="h3" note="Read from the game files.">Where it comes from</SectionHeading>
          </Card>
        </Specimen>

        <Specimen id="card" title="Card" note="One card: panel, hairline, 12 px corners. Dashed when unconfirmed.">
          <div className="grid gap-4 md:grid-cols-2">
            <Card><p className="font-semibold text-fg">A card</p><p className="mt-1 text-sm text-fg-2">Panel fill, line border, no shadow.</p></Card>
            <Card href="/tools/talents"><p className="font-semibold text-fg">A link card</p><p className="mt-1 text-sm text-fg-2">The border turns accent on hover.</p></Card>
          </div>
          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <Card unconfirmed><p className="font-semibold text-fg">Unconfirmed</p><p className="mt-1 text-sm text-fg-2">Dashed edge: from the game files, no player has confirmed it.</p></Card>
            <Card padding="none"><p className="border-b border-line px-4 py-3 text-sm font-semibold text-fg">No padding</p><p className="px-4 py-3 text-sm text-fg-2">For tables and lists that run to the edge.</p></Card>
          </div>
        </Specimen>

        <Specimen id="badge" title="Badge" note="Four tones and no others.">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="files" />
            <Badge tone="confirmed" />
            <Badge tone="neutral">Build 1.60.1.70450</Badge>
            {QUALITIES.map((q) => <Badge key={q} tone="quality" quality={q} />)}
          </div>
        </Specimen>

        <Specimen id="meter" title="AgreementMeter" note="The logo's diamond, once per install. Three filled: the fact is public.">
          <ul className="space-y-3">
            {[0, 1, 2, 3].map((n) => (
              <li key={n} className="flex flex-wrap items-center gap-6">
                <AgreementMeter count={n} />
                <AgreementMeter count={n} withText />
                <AgreementMeter count={n} size="lg" />
              </li>
            ))}
          </ul>
        </Specimen>

        <Specimen id="empty" title="EmptyState" note="Every empty dataset: the meter at its count, one sentence, one action.">
          <EmptyState message="Nobody has looted this in Forever yet. Collecting since the beta." />
          <EmptyState count={1} message="One install has seen this vendor. Two more and the price is public." />
          <EmptyState message="No save file uploaded this week." action={{ href: "/upload", label: "Upload a save file" }} />
        </Specimen>

        <Specimen id="table" title="DataTable" note="Dense rows, names in their quality colour, numbers in mono. At 390 px it scrolls inside its frame.">
          <DataTable
            caption="Example items"
            columns={COLUMNS}
            rows={ROWS}
            rowKey={(r) => String(r.id)}
            sort={{ key: "seen", direction: "desc" }}
            sortHref={(key, dir) => `/dev/system?sort=${key}&dir=${dir}#table`}
            footer={<><span>7 of 31,849 items</span><a href="/database" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Open the database →</a></>}
          />
          <DataTable
            caption="Drops of Linen Cloth"
            columns={COLUMNS.slice(0, 5)}
            rows={[]}
            rowKey={(r) => String(r.id)}
            empty={<EmptyState framed={false} message="Nobody has looted this in Forever yet." />}
          />
        </Specimen>

        <Specimen id="tabs" title="Tabs" note="State lives in the URL hash: add #sold-by to this address and reload.">
          <Card padding="none">
            <Tabs
              label="Item relations"
              inFrame
              tabs={[
                { id: "created-by", label: "Created by", count: 1, panel: <p className="p-4 text-sm text-fg-2">Blacksmithing, spell 10015.</p> },
                { id: "dropped-by", label: "Dropped by", count: 0, panel: <EmptyState framed={false} message="Nobody has looted this in Forever yet." /> },
                { id: "sold-by", label: "Sold by", count: 0, panel: <EmptyState framed={false} message="No vendor sighting yet." /> },
                { id: "used-in", label: "Used in", count: 7, panel: <div className="p-4"><DataTable caption="Used in" columns={COLUMNS.slice(0, 3)} rows={ROWS.slice(0, 3)} rowKey={(r) => String(r.id)} /></div> },
                { id: "sources", label: "Sources", panel: <p className="p-4 text-sm text-fg-2">Game files, build 1.60.1.70450.</p> },
              ]}
            />
          </Card>
        </Specimen>

        <Specimen id="tooltip" title="TooltipFrame" note="Game things keep the game's frame, dark in every theme.">
          <div className="flex flex-wrap items-start gap-6">
            <TooltipFrame name="Truesilver Champion" quality="rare" label="Truesilver Champion, from the game files" foot="Build 1.60.1.70450 · unconfirmed">
              <p>Binds when equipped</p>
              <p className="flex justify-between gap-4"><span>Two-Hand</span><span>Sword</span></p>
              <p className="text-q-uncommon">Made by Blacksmithing</p>
            </TooltipFrame>
            <TooltipFrame name="Linen Cloth" quality="common" foot="Build 1.60.1.70450 · unconfirmed"><p>Trade Goods · Cloth</p></TooltipFrame>
          </div>
        </Specimen>
      </div>
    </Container>
  );
}
