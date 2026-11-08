import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { continentPath } from "@/lib/map-view";
import { renderMapScreen, mapMetadata, queryString, resolveMap, type MapQuery } from "./map-screen";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { searchParams: Promise<MapQuery> }): Promise<Metadata> {
  return mapMetadata(await props.searchParams, null);
}

/**
 * The world map. `?continent=` was the old way to pick a continent; each now has its own page, so such a link
 * is sent there with the rest of its address.
 */
export default async function MapPage(props: { searchParams: Promise<MapQuery> }) {
  const query = await props.searchParams;
  if (query.continent !== undefined) {
    permanentRedirect(`${continentPath(resolveMap(query, null).continentId)}${queryString(query, ["continent"])}`);
  }
  return renderMapScreen(query, null);
}
