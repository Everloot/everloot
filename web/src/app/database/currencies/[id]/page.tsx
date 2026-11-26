import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { collectionsBuild, currencyEntries, currencyHref } from "@/lib/collectibles";
import { parseSegment } from "@/lib/completion-lists";
import { loadSiteAssets } from "@/lib/game-assets";
import { CollectiblePage, collectibleMetadata, FILES_NAME } from "../../collectible-page";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const entryOf = (segment: string) => {
  const id = parseSegment(segment);
  return id === null ? undefined : currencyEntries()?.find((c) => c.id === id);
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const currency = entryOf((await props.params).id);
  if (!currency) return { robots: { index: false, follow: true } };
  const cap = currency.max ? ` with a cap of ${currency.max.toLocaleString("en-US")}` : "";
  return collectibleMetadata({ name: currency.name, kind: "currency", path: currencyHref(currency.id, currency.name), about: `${currency.name}, a ${currency.category} currency in WoW: Forever${cap}.` });
}

export default async function CurrencyPage(props: Props) {
  const { id: segment } = await props.params;
  const currency = entryOf(segment);
  if (!currency) notFound();
  const path = currencyHref(currency.id, currency.name);
  if (`/database/currencies/${segment}` !== path) permanentRedirect(path);
  const assets = await loadSiteAssets();
  const cap = currency.max?.toLocaleString("en-US");
  const summary = [
    `A ${currency.category} currency in WoW: Forever.`,
    "No player report confirms currencies yet.",
    `The game files list it${cap ? `, with a cap of ${cap}` : ", with no cap"}.`,
    FILES_NAME,
  ];
  return (
    <CollectiblePage
      list="/database/currencies" path={path} name={currency.name} kind="Currency" id={currency.id}
      icon={assets?.currencyIcons.get(currency.id)}
      box={(currency.description || cap) && <>
        {currency.description && <p className="text-tip-yellow">{currency.description}</p>}
        {cap && <p>Maximum: {cap}</p>}
      </>}
      facts={[
        { label: "Category", value: currency.category },
        { label: "Cap", value: cap ?? "None in the files", numeric: Boolean(cap) },
        { label: "Build", value: collectionsBuild() ?? "Unrecorded", numeric: true },
      ]}
      summary={summary}
    />
  );
}
