import type { AuctionHouse } from "@everloot/protocol";
import type { ReactNode } from "react";
import { FilterMenu, LinkTabs, type FilterOption } from "@/components/ui";
import { HOUSES, houseParam, houseSlug, slugParam } from "@/lib/auction-house";
import RealmMemory from "./RealmMemory";
import { RealmName } from "./RealmName";

type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] ?? "" : value ?? "");

/**
 * The realm and house a market tool shows, from the URL: `?realm=<slug>&house=<alliance|horde|neutral>`, the same
 * names on every page with the picker (the Auction House pages carry the realm in the path instead). A value that is
 * not a realm slug or a house reads as none.
 */
export function realmHouseParams(search: Search): { realm: string | null; house: AuctionHouse | null } {
  return { realm: slugParam(one(search.realm)), house: houseParam(one(search.house) || undefined) ?? null };
}

/** `path` with the page's other parameters kept and `realm` and `house` set (or left out when none); `hash` last. */
export function realmHouseHref(path: string, search: Search, realm: string | null, house: AuctionHouse | null, hash = ""): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (k === "realm" || k === "house") continue;
    for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) params.append(k, x);
  }
  if (realm) params.set("realm", realm);
  if (house) params.set("house", houseSlug(house));
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}${hash}`;
}

export interface PickerRealm { slug: string; name: string; count?: number }

/** A house tab's item count: read out everywhere, drawn from 640 px up so four tabs fit a phone. */
function HouseCount({ n }: { n: number }) {
  return <span data-house-count className="sr-only tabular-nums text-muted sm:not-sr-only sm:ml-1">{` (${n.toLocaleString("en-US")})`}</span>;
}

/**
 * The one realm and house picker of the market tools (the Auction House, bags, disenchanting and the profession
 * pages' AH Ledger margins): a realm menu and a tab per auction house, every choice a link built by `href`, so a
 * view is a URL and works without JavaScript. Rendered on the server from the page's own reading of the URL. The
 * browser remembers the last choice (RealmMemory) and offers it on a page opened with no realm.
 */
export function RealmHousePicker({ realms, realm, house, href, houses = HOUSES, allRealms = false, allHouses = false, counts, remember, linkBase }: {
  realms: readonly PickerRealm[];
  /** The realm shown, by slug; null for none (or every realm, with `allRealms`). */
  realm: string | null;
  /** The house shown; null for none chosen (or every house, with `allHouses`). */
  house: AuctionHouse | null;
  href: (realm: string | null, house: AuctionHouse | null) => string;
  houses?: readonly AuctionHouse[];
  /** Offer "All realms" and "All houses", for the Auction House browse page. */
  allRealms?: boolean;
  allHouses?: boolean;
  /** Items behind each house tab (null: every house), drawn beside its name. */
  counts?: ReadonlyMap<AuctionHouse | null, number>;
  /** `redirect`: a page with no realm reloads with the remembered one; `link`: it offers a link; `save`: neither (RealmMemory). */
  remember: "redirect" | "link" | "save";
  linkBase?: string;
}) {
  const chosen = realm ? realms.find((r) => r.slug === realm) ?? null : null;
  const options: FilterOption[] = [
    ...(allRealms ? [{ label: "All realms", href: href(null, house), on: !realm, reset: true }] : []),
    ...realms.map((r) => ({ label: <RealmName name={r.name} />, href: href(r.slug, house), on: r.slug === realm, count: r.count })),
  ];
  const count = (h: AuctionHouse | null): ReactNode => (counts ? <HouseCount n={counts.get(h) ?? 0} /> : null);
  const tabs = [
    ...(allHouses ? [{ href: href(realm, null), label: <>All<span className="sr-only sm:not-sr-only sm:ml-1"> houses</span>{count(null)}</>, current: !house }] : []),
    ...houses.map((h) => ({ href: href(realm, h), label: <>{h}{count(h)}</>, current: house === h })),
  ];
  return (
    <div data-realm-house-picker className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FilterMenu label="Realm" control={{ type: "menu", key: "realm", label: "Realm", options }} />
        <RealmMemory
          realm={realm}
          name={chosen?.name ?? null}
          house={house ? houseSlug(house) : null}
          known={realms.map((r) => r.slug)}
          houses={houses.map(houseSlug)}
          mode={remember}
          linkBase={linkBase}
        />
      </div>
      <LinkTabs label="Auction house" tabs={tabs} />
    </div>
  );
}
