import { Badge, DataTable, type Column } from "@/components/ui";
import { editPath, shortPath, type SavedBuild } from "@/lib/saved-builds";
import BuildActions from "./BuildActions";
import type { BuildFacts } from "./describe";

const OLDER = "Made on an older game build than the calculator's tree. Open it to see what changed.";
const NEWER = "Made on a newer game build than the calculator's tree, which has not caught up with it yet.";

/**
 * Saved builds in the site's dense table: name, how the build reads, the game build it was made on (with the
 * quiet marker when that is older or newer than the tree), the short link and the actions. On a phone the name
 * carries the rest in one line.
 */
export default function BuildsTable({ builds, facts, caption, onCharacterPage = false }: {
  builds: SavedBuild[]; facts: Map<string, BuildFacts>; caption: string; onCharacterPage?: boolean;
}) {
  const fact = (b: SavedBuild) => facts.get(b.id) ?? { title: b.classSlug, older: false, newer: false };
  const columns: Column<SavedBuild>[] = [
    {
      key: "name", header: "Name",
      cell: (b) => (
        <span className="inline-flex min-w-0 items-center gap-2">
          <a href={editPath(b)} className="min-w-0 text-fg hover:text-accent [overflow-wrap:anywhere]">{b.name}</a>
          {onCharacterPage && b.active && <Badge tone="neutral">Active</Badge>}
        </span>
      ),
    },
    { key: "build", header: "Build", nowrap: true, cell: (b) => <span className="text-fg-2">{fact(b).title}</span> },
    {
      key: "game", header: "Game build", nowrap: true,
      cell: (b) => (
        <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-fg-2">
          {b.gameBuild}
          {fact(b).older && <Badge tone="files" title={OLDER}>made on an older game build</Badge>}
          {fact(b).newer && <Badge tone="files" title={NEWER}>made on a newer game build</Badge>}
        </span>
      ),
    },
    {
      key: "link", header: "Link", nowrap: true,
      cell: (b) => (b.shared ? <a href={shortPath(b.slug)} className="font-mono text-fg-2 hover:text-accent">{shortPath(b.slug)}</a> : <span className="text-muted">Off</span>),
    },
    { key: "actions", header: <span className="sr-only">Actions</span>, nowrap: true, cell: (b) => <BuildActions build={b} canActivate={onCharacterPage} /> },
  ];
  return (
    <DataTable
      dense
      caption={caption}
      columns={columns}
      rows={builds}
      rowKey={(b) => b.id}
      meta={(b) => (
        <span className="space-y-1">
          <span className="block">{fact(b).title} · {b.gameBuild}{fact(b).older && " (older build)"}{fact(b).newer && " (newer build)"} · {b.shared ? shortPath(b.slug) : "link off"}</span>
          <BuildActions build={b} canActivate={onCharacterPage} />
        </span>
      )}
    />
  );
}
