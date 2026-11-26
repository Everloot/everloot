import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import JsonLd from "@/components/JsonLd";
import { Container, Facts, InShort, OpenData, TooltipFrame } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { parseSegment } from "@/lib/completion-lists";
import { entityPageJsonLd } from "@/lib/jsonld";
import { pageMetadata } from "@/lib/seo";
import { holidayEntries, holidayHref, holidaysBuild, lastsLabel, startLabel } from "@/lib/world-events";
import { CLIENT_LABEL } from "@kb/edges";
import { EntityHeader, EntityTop, LINK } from "../../entity";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** Holidays with a guide of their own on the site, by the name the files give them. */
const GUIDES: Record<string, string> = { "Darkmoon Faire": "/guides/darkmoon-faire" };

const entryOf = (segment: string) => {
  const id = parseSegment(segment);
  return id === null ? undefined : holidayEntries()?.find((h) => h.id === id);
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const holiday = entryOf((await props.params).id);
  if (!holiday) return { robots: { index: false, follow: true } };
  const lasts = lastsLabel(holiday.hours);
  return {
    ...pageMetadata({ title: `${holiday.name} (holiday)`, description: `${holiday.name} in WoW: Forever${lasts ? `, lasting ${lasts}` : ""}. ${CLIENT_LABEL}.`, path: holidayHref(holiday.id, holiday.name), image: `${holidayHref(holiday.id, holiday.name)}/opengraph-image` }),
    robots: { index: true, follow: true },
  };
}

export default async function HolidayPage(props: Props) {
  const { id: segment } = await props.params;
  const holiday = entryOf(segment);
  if (!holiday) notFound();
  const path = holidayHref(holiday.id, holiday.name);
  if (`/database/holidays/${segment}` !== path) permanentRedirect(path);
  const lasts = lastsLabel(holiday.hours);
  const starts = holiday.starts.map(startLabel);
  const guide = GUIDES[holiday.name];
  const trail = [...(trailFor("/database/holidays") ?? []), { name: holiday.name, path }];
  const summary = [
    "A holiday or world event in WoW: Forever.",
    "No player report confirms holidays yet.",
    `The game files list it${starts[0] ? `, starting ${starts[0].charAt(0).toLowerCase()}${starts[0].slice(1)} server time` : ""}${lasts ? ` and lasting ${lasts}` : ""}.`,
    "The name and text are shown from the game files; players have not reported them yet.",
  ];
  return (
    <Container width="data">
      <article>
        <JsonLd data={entityPageJsonLd({ name: holiday.name, path, identifier: `holiday:${holiday.id}` })} />
        <EntityHeader trail={trail} title={holiday.name} meta={["Holiday", <span key="id" className="tabular-nums">ID {holiday.id}</span>]} />
        <EntityTop
          box={(
            <TooltipFrame name={holiday.name} label={`${holiday.name}, ${CLIENT_LABEL.toLowerCase()}`}>
              {holiday.description?.split("\n\n").map((p, i) => <p key={i} className={i > 0 ? "mt-1.5" : undefined}>{p}</p>)}
            </TooltipFrame>
          )}
          facts={(
            <Facts
              layout="list"
              label={`${holiday.name}: quick facts`}
              items={[
                { label: starts.length > 1 ? "Starts" : "Start", value: starts.length ? <ul>{starts.map((s) => <li key={s}>{s}</li>)}</ul> : "None in the files" },
                { label: "Lasts", value: lasts ?? "None in the files" },
                ...(guide ? [{ label: "Guide", value: <Link href={guide} className={LINK}>{holiday.name} guide</Link> }] : []),
                { label: "Build", value: holidaysBuild() ?? "Unrecorded", numeric: true },
              ]}
            />
          )}
        />
        <p className="mb-4 text-meta text-muted">Times are server time, as the game files give them.</p>
        <InShort summary="In short" bullets={summary} note={<Link href="/database#reading" className={LINK}>How to read these numbers</Link>} />
        <OpenData report={{ type: "Holiday", id: holiday.id, path }} text={[`${holiday.name} (holiday ${holiday.id})`, ...summary, `Source: https://everloot.app${path}`].join("\n")} />
      </article>
    </Container>
  );
}
