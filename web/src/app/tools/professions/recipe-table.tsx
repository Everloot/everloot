"use client";

import Link from "next/link";
import Badge, { UNCONFIRMED_TITLE } from "@/components/ui/Badge";
import { CoinText } from "@/components/ui/Coins";
import DataTable, { type Column } from "@/components/ui/DataTable";
import SectionHeading from "@/components/ui/SectionHeading";

/**
 * The profession page's game-file recipe tables, drawn from ids. The server page passes each item once (`items`), each
 * row as numbers, and the icons as file names under one `iconBase`, so the page's RSC data carries the recipes' facts
 * and not their markup a second time; the HTML is rendered on the server as before. The cells use short classes
 * (globals.css, `pf-*`) with the same styles as GameIcon, Badge and the page's links: live alchemy was 901 kB.
 */

/** An item a row names: its shown name, its colour (a hex from the name rule, or a quality text class), its icon file. */
export interface RecipeItem { name: string; color?: string; tone?: string; icon?: string; files?: true }

export interface RecipeRow {
  id: number;
  name?: string;
  icon?: string;
  makes?: number;
  /** [item id, count] pairs. */
  reagents: [number, number][];
  learn?: number;
  yellow?: number;
  grey?: number;
  /** The recipe items the files link to this spell. */
  taught?: number[];
  /** What three agreeing installs saw: "yellow 10, green 12, grey 15", and a cost per craft as coin text. */
  players?: { installs: number; text: string; cost?: string };
}

export interface RecipeTablesProps {
  profession: string;
  groups: { key: string; label: string; rows: RecipeRow[] }[];
  items: Record<number, RecipeItem>;
  iconBase: string;
  /** The shopping plan link with `RECIPEID` where the spell id goes. */
  planHref: string;
  learn: boolean;
  players: boolean;
}

const dash = <span className="text-muted">—</span>;
/** A file name under `iconBase`, or a whole URL where an icon came from elsewhere. */
const iconSrc = (base: string, icon?: string) => (icon ? (icon.includes("//") ? icon : base + icon) : undefined);

/** GameIcon in short classes, or its empty frame where there is no icon. */
export function Icon({ src, size }: { src?: string; size: 16 | 20 | 24 }) {
  // eslint-disable-next-line @next/next/no-img-element -- the asset bucket's small WebP files, as GameIcon
  return src ? <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" className={`pf-ic pf-${size}`} />
    : <span aria-hidden="true" className={`pf-ic0 pf-${size}`} />;
}

/** Badge tone="files", in short classes: the same 10 px hollow diamond, tooltip and screen reader word. */
const Files = () => (
  <span data-badge="files" title={UNCONFIRMED_TITLE} className="pf-f"><span aria-hidden="true" className="pf-fd" /><span className="sr-only">unconfirmed</span></span>
);

/** An item with its icon, count, name in its colour and files marker, as the page's ItemLink drew it. */
function ItemLink({ items, iconBase, id, size = 24, count }: { items: Record<number, RecipeItem>; iconBase: string; id: number; size?: 16 | 20 | 24; count?: number }) {
  const item = items[id];
  return (
    <span className="pf-ir">
      <Icon src={iconSrc(iconBase, item?.icon)} size={size} />
      {count !== undefined && <span className="pf-q">{`${count}×`}</span>}
      <Link prefetch={false} href={`/database/items/${id}`} className={item?.tone ? `pf-il ${item.tone}` : "pf-il"} style={item?.color ? { color: item.color } : undefined}>
        {item?.name ?? `Item ${id}`}
      </Link>
      {item?.files && <Files />}
    </span>
  );
}

export default function RecipeTables({ profession, groups, items, iconBase, planHref, learn, players }: RecipeTablesProps) {
  const columns: Column<RecipeRow>[] = [
    {
      key: "recipe", header: "Recipe", cell: (r) => (
        <span className="pf-rc">
          <span className="pf-rn">
            <Icon src={iconSrc(iconBase, r.icon)} size={24} />
            <Link prefetch={false} href={`/database/spells/${r.id}`} className="lnk min-w-0">{r.name ?? `Spell ${r.id}`}</Link>
            <Files />
          </span>
          {r.reagents.length > 0 && <Link prefetch={false} href={planHref.replace("RECIPEID", String(r.id))} className="lnk">Plan this recipe</Link>}
          {r.taught && <span className="pf-rt">Recipe item: {r.taught.map((id) => <ItemLink key={id} items={items} iconBase={iconBase} id={id} size={16} />)}</span>}
        </span>
      ),
    },
    { key: "makes", header: "Makes", cell: (r) => (r.makes ? <ItemLink items={items} iconBase={iconBase} id={r.makes} /> : dash) },
    {
      key: "reagents", header: "Reagents", cell: (r) => r.reagents.length
        ? <ul className="pf-rl">{r.reagents.map(([id, count]) => <li key={id}><ItemLink items={items} iconBase={iconBase} id={id} size={20} count={count} /></li>)}</ul>
        : dash,
    },
    ...(learn ? [{ key: "learn", header: "Needs", numeric: true, cell: (r: RecipeRow) => r.learn ?? dash }] : []),
    { key: "yellow", header: "Yellow", numeric: true, cell: (r) => r.yellow ?? dash },
    { key: "grey", header: "Grey", numeric: true, cell: (r) => r.grey ?? dash },
    ...(players ? [{
      key: "players", header: "Players saw", cell: (r: RecipeRow) => {
        const t = r.players;
        if (!t) return dash;
        return (
          <span className="text-cell-2 text-fg-2">
            <Badge tone="confirmed">{t.installs} installs</Badge>{" "}{t.text}
            {t.cost !== undefined && <>; <CoinText text={t.cost} /> a craft</>}
          </span>
        );
      },
    }] : []),
  ];
  return groups.map((g) => (
    <section key={g.key} aria-labelledby={`skill-${g.key}`} data-skill-group={g.key} className="space-y-2">
      <SectionHeading id={`skill-${g.key}`} as="h3">{g.label}</SectionHeading>
      <DataTable dense caption={`${profession} recipes, ${g.label}: ${g.rows.length}`} columns={columns} rows={g.rows} rowKey={(r) => String(r.id)} />
    </section>
  ));
}
