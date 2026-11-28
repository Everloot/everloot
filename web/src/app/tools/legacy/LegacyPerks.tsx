import Link from "@/components/Link";
import { DataTable, SectionHeading, type Column } from "@/components/ui";
import type { LegacyPerkCatalog, Node, Tree } from "@kb/legacy-perks/catalog";
import LegacyPlanner from "./LegacyPlanner";
import { orderedPerks, treeName } from "./plan";

/** All catalog rows stay available below the planner, including perks with unresolved rank availability. */
export default function LegacyPerks({ catalog }: { catalog: LegacyPerkCatalog }) {
  // The columns of every tree share the same PosX values; number them left to right.
  const xs = [...new Set(catalog.trees.flatMap((t) => t.nodes.map((n) => n.x)).filter((x): x is number => x !== null))].sort((a, b) => a - b);
  const column = (n: Node) => (n.x === null ? null : xs.indexOf(n.x) + 1);
  const cap = (id: number | null) => catalog.currencies.find((c) => c.id === id)?.cap;

  return (
    <div className="space-y-10">
      <p className="text-sm text-muted">
        Found in game files, unconfirmed.{" "}
        <Link href={`/changes?show=builds&q=${catalog.build.version}`} className="underline decoration-edge underline-offset-4 hover:decoration-fg">{`Read from build ${catalog.build.version}`}</Link>
        {` on ${catalog.build.extractedAt.slice(0, 10)}, trait system ${catalog.traitSystemId}. `}
        {catalog.credit}{" "}
        <a href="#legacy-reference" className="underline decoration-edge underline-offset-4 hover:decoration-fg">View the game-file reference</a>
      </p>

      <LegacyPlanner catalog={catalog} />

      <SectionHeading id="legacy-reference">Game-file perk reference</SectionHeading>
      {catalog.trees.map((tree) => {
        const id = `tree-${tree.id}`;
        const c = cap(tree.currencyId);
        const name = treeName(tree);
        const files = [`tree ${tree.id}`];
        if (tree.cost.value !== null) files.push(`cost per rank from ${tree.cost.from}`);
        if (c && c.value !== null) files.push(`most points from ${c.from}`);
        return (
          <section key={tree.id} aria-labelledby={id}>
            <SectionHeading
              id={id}
              note={<>
                {name ? "The game files give this tree no name; it is named here by its top perk. " : "The game files give this tree no name. "}
                {`${tree.nodes.length} perks. `}
                {`Cost per rank: ${tree.cost.value === null ? "not known" : `${tree.cost.value} (unconfirmed)`}. `}
                {`Most points a character holds: ${!c || c.value === null ? "not known" : `${c.value} (unconfirmed)`}.`}
              </>}
            >
              {name ? `${name} tree` : `Legacy tree ${tree.id}`}
            </SectionHeading>
            <DataTable caption={`Perks of the ${name ? `${name} tree` : `Legacy tree ${tree.id}`}`} columns={perkColumns(tree, column)} rows={orderedPerks(tree.nodes)} rowKey={(n) => String(n.id)} />
            <p className="mt-2 text-xs text-muted">{`From the game files: ${files.join("; ")}.`}</p>
          </section>
        );
      })}

      <section aria-labelledby="legacy-open">
        <SectionHeading id="legacy-open">What the files leave open</SectionHeading>
        <ul className="list-disc space-y-2 pl-5 text-sm text-fg-2">
          <li>Spend gates are partial: the points a gate asks for are stored, but where those points are counted is read from a column name and is unconfirmed.</li>
          <li>The cost per rank and the shared cap are readings of column names. The planner shows them as estimates.</li>
          <li>This catalog leaves point sources and challenge criteria open. The achievement catalog shows point rewards on entries such as <Link href="/database/achievements/684" className="underline decoration-edge underline-offset-4 hover:decoration-fg">Conqueror of the Lair</Link>.</li>
          {catalog.emptyTreeIds.length > 0 && <li>{`Trait system ${catalog.traitSystemId} also holds ${catalog.emptyTreeIds.length === 1 ? "tree" : "trees"} ${catalog.emptyTreeIds.join(", ")}, with no perks.`}</li>}
          {catalog.warnings.map((w) => <li key={w}>{w}</li>)}
          {catalog.withdrawn.map((w) => (
            <li key={`${w.kind}-${w.id}`}>{`Withdrawn ${w.kind} ${w.id}${w.name ? ` (${w.name})` : ""}: last in build ${w.lastSeen}, gone in ${w.withdrawnIn}.`}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const nodeName = (n: Node) => n.entries[0]?.name ?? "No name in the files";

function perkColumns(tree: Tree, column: (n: Node) => number | null): Column<Node>[] {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const gatesOn = (n: Node) => tree.gates.filter((g) => g.guards.includes(n.id));
  return [
    { key: "perk", header: "Perk", cell: (n) => <>{nodeName(n)}{n.kind === "tiered" && <span className="text-muted">{` (${n.entries.length} tiers)`}</span>}</> },
    { key: "node", header: "Node id", numeric: true, cell: (n) => n.id },
    { key: "entries", header: "Entry ids", numeric: true, cell: (n) => n.entries.map((e) => e.id).join(", ") },
    { key: "ranks", header: "Ranks", numeric: true, cell: (n) => n.ranks.value ?? "Not known" },
    { key: "column", header: "Column", numeric: true, cell: (n) => column(n) ?? "Not known" },
    {
      key: "requires",
      header: "Requires",
      cell: (n) => n.prereqs.length
        ? n.prereqs.map((p) => `${byId.get(p.nodeId) ? nodeName(byId.get(p.nodeId)!) : `node ${p.nodeId}`}${p.rule === null ? " (rule not known)" : ""}`).join(n.prereqs.every((p) => p.rule === "all") ? " and " : " or ")
        : "—",
    },
    {
      key: "gate",
      header: "Spend gate",
      cell: (n) => gatesOn(n).map((g) => `${g.amount} points spent (${g.confidence === "unknown" ? "where they count is not known" : "where they count is unconfirmed"})`).join("; ") || "—",
    },
  ];
}
