import { Badge, Card, DataTable, SectionHeading, type Column } from "@/components/ui";
import { CLIENT_MOUNTS } from "@/data/game-data/client-mounts";
import type { ClientMount } from "../../../../../kb/src/client-mounts";

export interface MountRow extends ClientMount { id: number; /** True when 3 installs list this mount's spell in their mount collection. */ reported: boolean }

/** The files' mounts, player-first: the ones 3 installs report lead, in the files' id order; the rest follow unconfirmed. */
export function mountRows(agreedSpellIds: ReadonlySet<number>, mounts: Readonly<Record<string, ClientMount>> = CLIENT_MOUNTS.mounts): MountRow[] {
  const rows = Object.entries(mounts).map(([id, m]) => ({ id: Number(id), ...m, reported: agreedSpellIds.has(m.spellId) })).sort((a, b) => a.id - b.id);
  return [...rows.filter((r) => r.reported), ...rows.filter((r) => !r.reported)];
}

export default function MountsView({ agreedSpellIds, unreachable }: { agreedSpellIds: ReadonlySet<number>; unreachable: boolean }) {
  const rows = mountRows(agreedSpellIds);
  const reported = rows.filter((r) => r.reported).length;
  const columns: Column<MountRow>[] = [
    { key: "name", header: "Mount", cell: (r) => (r.reported ? r.name : <span className="inline-flex items-baseline gap-1.5"><Badge tone="files" />{r.name}</span>) },
    { key: "riding", header: "Riding skill", numeric: true, cell: (r) => r.ridingSkill ?? <span className="text-muted">–</span> },
    { key: "spell", header: "Spell", numeric: true, cell: (r) => <span className="font-mono text-xs text-muted">{r.spellId}</span> },
  ];
  return (
    <section aria-labelledby="mounts-heading">
      <SectionHeading id="mounts-heading" note={`A mount is listed as reported once 3 installs upload it in their mount collection; the rest are the game files' own list for build ${CLIENT_MOUNTS.build.version}, marked unconfirmed. Riding skill is the lowest the mount's type asks for in the files.`}>
        Mounts
      </SectionHeading>
      <Card as="div" className="mb-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted">Reported by players</dt><dd className="text-fg">{unreachable ? "unrecorded" : reported}</dd>
          <dt className="text-muted">In the files</dt><dd className="text-fg"><span className="inline-flex items-baseline gap-1.5"><Badge tone="files" />{rows.length}</span></dd>
        </dl>
      </Card>
      <DataTable dense caption="Mounts players report, and the ones the game files list" columns={columns} rows={rows} rowKey={(r) => String(r.id)} />
    </section>
  );
}
