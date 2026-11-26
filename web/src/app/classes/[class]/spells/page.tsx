import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CLASS_TEXT } from "@/components/talents/TalentTreeView";
import { Container, PageHeader } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { classLabel } from "@/lib/class-context";
import { classSpellLevels } from "@/lib/class-hub";
import { loadSiteAssets, loadSpellNames } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@/lib/items";
import { pageMetadata } from "@/lib/seo";
import { SPELLS_BUILD } from "@/lib/spell-card";
import { isTalentClass } from "@/lib/talents/catalogs";
import { ListNote, NameCell } from "../../../database/list-parts";

// The spell names are read from private storage on each request, as on the spell pages; the class hub is built once
// per deploy and cannot read them, so the list by level is a page of its own.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ class: string }> };

const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { class: slug } = await params;
  if (!isTalentClass(slug)) return { robots: { index: false, follow: true } };
  const name = classLabel(slug);
  return {
    ...pageMetadata({
      title: `WoW Forever ${name} Spells by Level`,
      description: `The ${name} spells on the class's own skill lines in the WoW: Forever game files, by the level the files give each one, linking every spell's page.`,
      path: `/classes/${slug}/spells`,
    }),
    // Ranks, talents and helper spells mixed as the files have them, with names from the files alone: kept out of
    // search until players confirm what a trainer teaches.
    robots: { index: false, follow: true },
  };
}

/**
 * A class's spells by the level the game files give each (lib/class-hub.ts, classSpellLevels): the spells on its class
 * skill lines, which mix ranks, talents, passives and helper spells, as the files do. The names follow the spell name
 * rule (docs/DATA_POLICY.md): the files' own, with the unconfirmed marker, and "Spell N" where there is none.
 */
export default async function ClassSpellsPage({ params }: Params) {
  const { class: slug } = await params;
  if (!isTalentClass(slug)) notFound();
  const name = classLabel(slug);
  const { levels, unleveled } = classSpellLevels(slug);
  const [names, assets] = await Promise.all([loadSpellNames(CLIENT_LAYER.build.version), loadSiteAssets()]);
  const count = levels.reduce((n, l) => n + l.spells.length, 0);

  return (
    <Container>
      <PageHeader
        trail={[...trailFor("/classes")!, { name, path: `/classes/${slug}` }, { name: "Spells by level", path: `/classes/${slug}/spells` }]}
        title={<><span className={CLASS_TEXT[slug]}>{name}</span> spells by level</>}
        lede={`${count} ${name} spells with the level the game files give, lowest first.`}
      />
      <ListNote files>
        {`The spells on the ${name}'s own skill lines in build ${SPELLS_BUILD}: ranks, talents, passives and helper spells mixed as the files have them, unconfirmed. Nothing in the files says which a trainer teaches or what it costs. `}
        {!names && "The spell names could not be read, so each spell is listed by number. "}
        {unleveled > 0 && <>{`${unleveled} more ${name} spells have no level in the files: `}<Link href={`/database/spells?class=${slug}`} className={LINK}>{`every ${name} spell`}</Link>{" lists them. "}</>}
        <Link href={`/classes/${slug}`} className={LINK}>{`Back to the ${name}`}</Link>
      </ListNote>
      <div className="mt-6 space-y-6">
        {levels.map(({ level, spells }) => (
          <section key={level} aria-labelledby={`level-${level}`}>
            <h2 id={`level-${level}`} className="border-b border-line pb-1 text-sm font-semibold text-fg">{`Level ${level}`}</h2>
            <ul className="mt-2 grid gap-x-6 gap-y-1.5 text-cell sm:grid-cols-2 lg:grid-cols-3">
              {spells.map((id) => (
                <li key={id} className="min-w-0">
                  <NameCell href={`/database/spells/${id}`} icon={assets?.spellIcons.get(id)}>{names?.names.get(id) || `Spell ${id}`}</NameCell>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Container>
  );
}
