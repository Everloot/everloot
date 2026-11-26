import type { Metadata } from "next";
import type { ReactNode } from "react";
import { EntityIcon } from "@/components/game/EntityIcon";
import { TooltipFrame } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { pageMetadata } from "@/lib/seo";
import { CLIENT_LABEL } from "@kb/edges";
import { EntityPage } from "./entity";

// The page of one mount, companion pet or currency, through the shared entity template: the header with its icon,
// the tooltip box and quick facts, In short and Open data. Every one is the game files' entry, labelled found in game
// files, unconfirmed until players confirm it.

/** The name line of a page whose name is the game files', in the words the title pages use. */
export const FILES_NAME = "The name is shown from the game files; players have not reported it yet.";

export interface Fact { label: string; value: ReactNode; numeric?: boolean }

/** A page's metadata: indexed, its description ending on the unconfirmed label unless players confirmed it. */
export function collectibleMetadata({ name, kind, path, confirmed = false, about }: { name: string; kind: string; path: string; confirmed?: boolean; about: string }): Metadata {
  return {
    ...pageMetadata({ title: `${name} (${kind})`, description: `${about}${confirmed ? "" : ` ${CLIENT_LABEL}.`}`, path, image: `${path}/opengraph-image` }),
    robots: { index: true, follow: true },
  };
}

export function CollectiblePage({ list, path, name, kind, id, icon, confirmed = false, box, facts, summary }: {
  /** The list the page belongs to (its breadcrumb parent). */
  list: string;
  path: string; name: string; kind: string; id: number;
  icon?: string | null; confirmed?: boolean;
  /** The lines inside the tooltip box under the name, if any. */
  box?: ReactNode;
  facts: Fact[];
  summary: string[];
}) {
  const trail = [...(trailFor(list) ?? []), { name, path }];
  const label = confirmed ? `${name}, as players reported it` : `${name}, ${CLIENT_LABEL.toLowerCase()}`;
  return (
    <EntityPage
      name={name}
      jsonLd={{ name, path, identifier: `${kind.toLowerCase().replace(/\s+/g, "-")}:${id}` }}
      header={{ trail, title: name, icon: <EntityIcon src={icon} unconfirmed={!confirmed} />, meta: [kind, <span key="id" className="tabular-nums">ID {id}</span>] }}
      box={<TooltipFrame name={name} label={label}>{box}</TooltipFrame>}
      facts={facts}
      summary={summary}
      openData={{ report: { type: kind, id, path }, text: [`${name} (${kind.toLowerCase()} ${id})`, ...summary, `Source: https://everloot.app${path}`].join("\n") }}
    />
  );
}
