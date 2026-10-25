import Link from "next/link";
import { Card, DataTable, LinkTabs, type Column } from "@/components/ui";
import { achievementHref, chainHref, factionHref, titleHref } from "@/lib/completion-lists";
import type { CompletionFacts, CompletionKind, Overview, OverviewCategory, OwnedCharacter } from "../../../../../kb/src/completion";
import { Bar } from "./CompletionView";
import { SHOWS, categoryRows, filterRows, viewHref, type CategoryRow, type Show, type ViewQuery } from "./overview";

const KIND_HEADING: Record<CompletionKind, string> = { achievements: "Achievements", reputation: "Reputation", titles: "Titles", quests: "Quest chains" };
const SHOW_LABEL: Record<Show, string> = { all: "All", done: "Done", missing: "Missing", started: "Started" };

const percent = (done: number, total: number) => (total > 0 ? Math.floor((done / total) * 100) : 0);

function Counts({ done, total, measured }: { done: number; total: number; measured: boolean }) {
  return (
    <span className="font-mono text-xs tabular-nums text-fg-2">
      {done.toLocaleString("en-US")} of {total.toLocaleString("en-US")}{measured && ` · ${percent(done, total)}%`}
    </span>
  );
}

/** "Total complete": every kind added once, as overviewOf counts it. */
export function TotalBar({ overview, measured }: { overview: Overview; measured: boolean }) {
  const { done, total } = overview.total;
  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-fg">Total complete</h2>
        <Counts done={done} total={total} measured={measured} />
      </div>
      <Bar done={done} total={total} label="Total complete" />
    </Card>
  );
}

function BarRow({ cat, q, measured, sub }: { cat: OverviewCategory; q: ViewQuery; measured: boolean; sub?: boolean }) {
  return (
    <li className={`space-y-1.5 ${sub ? "pl-4" : ""}`}>
      <div className="flex items-baseline justify-between gap-3">
        <Link href={viewHref({ ...q, view: cat.id, show: undefined })} className={`min-w-0 text-sm hover:text-fg underline decoration-edge underline-offset-4 hover:decoration-fg ${sub ? "text-fg-2" : "text-fg"}`}>
          {cat.label}
        </Link>
        <Counts done={cat.done} total={cat.total} measured={measured} />
      </div>
      <Bar done={cat.done} total={cat.total} label={cat.label} />
      {cat.points && <p className="text-xs text-muted">{cat.points.have.toLocaleString("en-US")} of {cat.points.of.toLocaleString("en-US")} points</p>}
    </li>
  );
}

/** One bar per category, grouped by kind; a reputation header is drawn under the reputation bar it breaks down. */
export function OverviewBars({ overview, q, measured }: { overview: Overview; q: ViewQuery; measured: boolean }) {
  const kinds: CompletionKind[] = ["achievements", "reputation", "titles", "quests"];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {kinds.map((kind) => {
        const cats = overview.categories.filter((c) => c.kind === kind);
        if (cats.length === 0) return null;
        return (
          <Card key={kind} as="section" aria-labelledby={`kind-${kind}`} className="space-y-4">
            <h3 id={`kind-${kind}`} className="text-base font-semibold text-fg">{KIND_HEADING[kind]}</h3>
            <ul className="space-y-4">
              {cats.map((c) => <BarRow key={c.id} cat={c} q={q} measured={measured} sub={kind === "reputation" && Boolean(c.group)} />)}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

const muted = (text: string) => <span className="text-muted">{text}</span>;

function nameHref(row: CategoryRow): string {
  if (row.kind === "achievements") return achievementHref(row.entry.achievementId, row.entry.name);
  if (row.kind === "reputation") return factionHref(row.entry.factionId, row.entry.name);
  if (row.kind === "titles") return titleHref(row.entry.titleId, row.entry.name);
  return chainHref(row.entry.questLineId, row.entry.name);
}

const rowId = (row: CategoryRow) =>
  row.kind === "achievements" ? row.entry.achievementId : row.kind === "reputation" ? row.entry.factionId : row.kind === "titles" ? row.entry.titleId : row.entry.questLineId;

/** What the character has against one row, in words. */
function status(row: CategoryRow): string {
  if (row.kind === "achievements") {
    if (row.done) return row.earnedOn ? `Done ${row.earnedOn}` : "Done";
    return row.progress ? `${row.progress.have} of ${row.progress.of} ${row.progress.unit}` : "Not done";
  }
  if (row.kind === "reputation") {
    if (row.standing) return row.toNext !== undefined ? `${row.standing}, ${row.toNext.toLocaleString("en-US")} to go` : row.standing;
    return row.value !== undefined ? `Value ${row.value}, scale unknown` : "No standing reported";
  }
  if (row.kind === "titles") return row.done ? "Known" : "Not known";
  return row.done ? "Finished" : row.have > 0 ? "Started" : "Not started";
}

function columnsFor(cat: OverviewCategory, measured: boolean): Column<CategoryRow>[] {
  const name: Column<CategoryRow> = {
    key: "name", header: "Name",
    cell: (row) => <Link href={nameHref(row)} className="text-fg hover:text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{row.entry.name}</Link>,
  };
  const cols: Column<CategoryRow>[] = [name];
  if (cat.kind === "achievements") {
    if (!cat.group) cols.push({ key: "category", header: "Category", cell: (row) => (row.kind === "achievements" ? row.entry.category : null) });
    cols.push({ key: "points", header: "Points", numeric: true, cell: (row) => (row.kind === "achievements" ? row.entry.points : null) });
  }
  if (cat.kind === "reputation" && !cat.group) {
    cols.push({ key: "header", header: "Group", cell: (row) => (row.kind === "reputation" ? row.entry.header ?? muted("—") : null) });
  }
  if (cat.kind === "quests") {
    cols.push({
      key: "quests", header: "Quests", numeric: true,
      cell: (row) => {
        if (row.kind !== "quests") return null;
        const total = row.truncated ? `at least ${row.total}` : String(row.total);
        return measured ? `${row.have} of ${total}` : total;
      },
    });
  }
  if (measured) {
    cols.push({ key: "status", header: "Status", nowrap: true, cell: (row) => <span className={row.done ? "text-accent" : "text-fg-2"}>{status(row)}</span> });
  }
  return cols;
}

/**
 * One category's rows, with done / missing / started as GET links. With no character there is nothing to filter:
 * the agreed list is shown as it is.
 */
export function CategoryDetail({ facts, character, cat, q, show, categories }: {
  facts: CompletionFacts; character: OwnedCharacter | null; cat: OverviewCategory; q: ViewQuery; show: Show; categories: OverviewCategory[];
}) {
  const measured = character !== null;
  const all = categoryRows(facts, character, cat);
  const active = measured ? show : "all";
  const rows = filterRows(all, active);
  const shows = SHOWS.filter((s) => s !== "started" || cat.kind !== "titles");
  const filterTabs = shows.map((s) => ({
    href: viewHref({ ...q, view: cat.id, show: s }), label: SHOW_LABEL[s], current: s === active, count: filterRows(all, s).length,
  }));
  const noun = KIND_HEADING[cat.kind].toLowerCase();

  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Categories" className="min-w-0">
        <ul>
          <li>
            <Link href={viewHref({ ...q, view: undefined, show: undefined })} className="flex min-h-7 items-center rounded-control px-2 text-control text-fg-2 hover:bg-panel hover:text-fg">
              Overview
            </Link>
          </li>
          {categories.map((c) => (
            <li key={c.id}>
              <Link
                href={viewHref({ ...q, view: c.id, show: undefined })}
                aria-current={c.id === cat.id ? "page" : undefined}
                className={`flex min-h-7 items-center gap-2 rounded-control pr-2 text-control hover:bg-panel hover:text-fg ${c.id === cat.id ? "bg-panel font-medium text-fg" : "text-fg-2"} ${c.kind === "reputation" && c.group ? "pl-5" : "pl-2"}`}
              >
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                <span className="tabular-nums text-muted">{measured ? `${c.done}/${c.total}` : c.total}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <section aria-labelledby="detail-heading" className="min-w-0 space-y-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="detail-heading" className="text-lg font-semibold text-fg">
              {cat.kind === "achievements" ? `${cat.label} achievements` : cat.group ? `${cat.label} reputation` : cat.label}
            </h2>
            <Counts done={cat.done} total={cat.total} measured={measured} />
          </div>
          <Bar done={cat.done} total={cat.total} label={cat.label} />
        </div>
        {measured
          ? <LinkTabs label="Show" tabs={filterTabs} />
          : <p className="text-sm text-fg-2">Enter an install id to see which of these a character has done.</p>}
        <DataTable
          dense
          caption={`${cat.label}: ${rows.length} ${noun}`}
          columns={columnsFor(cat, measured)}
          rows={rows}
          rowKey={(row) => String(rowId(row))}
          meta={measured ? (row) => status(row) : undefined}
          empty={
            <div className="flex flex-wrap items-center gap-2 py-4 text-cell text-fg-2">
              <span>{active === "all" ? "Nothing listed here yet." : `Nothing ${SHOW_LABEL[active].toLowerCase()} here.`}</span>
              <Link href={viewHref({ ...q, view: cat.id, show: undefined })} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Show all</Link>
            </div>
          }
        />
      </section>
    </div>
  );
}
