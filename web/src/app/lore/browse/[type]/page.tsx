import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { notFound } from "next/navigation";
import BrowseFilters from "@/components/BrowseFilters";
import { Card, Container, PageHeader, Pager } from "@/components/ui";
import LoreSource from "@/components/LoreSource";
import { trailFor } from "@/lib/breadcrumbs";
import {
  browse, BROWSE_HEADINGS, BROWSE_TYPES, FACET_KEYS, facetValues, hasTypes, LETTERS, lettersWithRows, loreSlug,
  parseLetter, PRE_CLASSIFICATION_COPY, UNAVAILABLE, UNAVAILABLE_COPY, type BrowseSlug, type FacetKey,
} from "@/lib/lore";

export const dynamic = "force-dynamic";

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

/** The page's one source line: everything here is the 2023 wiki. */
const SOURCE = <LoreSource />;

type RawQuery = Partial<Record<FacetKey | "letter" | "page", string | string[]>>;
type Query = Partial<Record<FacetKey | "letter" | "page", string>>;
type Props = { params: Promise<{ type: string }>; searchParams: Promise<RawQuery> };

/** Next hands a repeated parameter over as an array; the first value is the one we answer. */
function firstValues(raw: RawQuery): Query {
  const out: Query = {};
  for (const [k, v] of Object.entries(raw)) out[k as keyof Query] = Array.isArray(v) ? v[0] : v;
  return out;
}

function slugOf(type: string): BrowseSlug | null {
  return Object.hasOwn(BROWSE_TYPES, type) ? (type as BrowseSlug) : null;
}

function filtersOf(query: Query): Partial<Record<FacetKey, string>> {
  const out: Partial<Record<FacetKey, string>> = {};
  for (const key of FACET_KEYS) if (query[key]) out[key] = query[key];
  return out;
}

function pageNumber(raw: string | undefined): number {
  return raw && /^[1-9]\d*$/.test(raw) ? Number(raw) : 1;
}

/** `/lore/<type>` for letter a, else `/lore/<type>?letter=<l>`: the only indexed form. */
function letterUrl(slug: BrowseSlug, letter: string): string {
  return letter === "a" ? `/lore/${slug}` : `/lore/${slug}?letter=${encodeURIComponent(letter)}`;
}

/** The letter to list: the given one; none when a facet filter is set without a letter; "a" otherwise. */
function letterOf(query: Query): string | null | undefined {
  if (query.letter === undefined) return Object.keys(filtersOf(query)).length > 0 ? null : "a";
  return parseLetter(query.letter) ?? undefined;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { type } = await props.params;
  const query = firstValues(await props.searchParams);
  const slug = slugOf(type);
  const letter = letterOf(query);
  if (!slug || letter === undefined) return { robots: { index: false, follow: true } };
  const typed = hasTypes();
  const clean = Object.keys(filtersOf(query)).length === 0 && !query.page;
  const letters = typed === true && letter !== null ? lettersWithRows(BROWSE_TYPES[slug]) : null;
  const emptyLetter = letter !== null && letters !== null && letters !== UNAVAILABLE && !letters.includes(letter);
  return {
    ...pageMetadata({
      title: `${BROWSE_HEADINGS[slug]}${letter ? ` starting with ${letter.toUpperCase()}` : ""} · Lore archive`,
      description: `${BROWSE_HEADINGS[slug]} from the Warcraft Wiki as of November 2023, CC BY-SA 4.0, by name. Not WoW: Forever data.`,
      path: letterUrl(slug, letter ?? "a"),
    }),
    robots: { index: typed === true && clean && !emptyLetter, follow: true },
  };
}

export default async function BrowsePage(props: Props) {
  const { type } = await props.params;
  const query = firstValues(await props.searchParams);
  const slug = slugOf(type);
  if (!slug) notFound();
  const letter = letterOf(query);
  if (letter === undefined) notFound();
  const heading = BROWSE_HEADINGS[slug];
  const trail = trailFor(`/lore/${slug}`)!;
  const typed = hasTypes();

  if (typed === UNAVAILABLE) {
    return (
      <Container width="reading">
        <article>
          <PageHeader trail={trail} title="Lore archive unavailable" />
          <Card><p className="text-fg-2">{UNAVAILABLE_COPY}</p></Card>
        </article>
      </Container>
    );
  }
  if (!typed) {
    return (
      <Container width="reading">
        <article>
          <PageHeader trail={trail} title={heading} />
          <Card>
            <p className="text-fg-2">
              {PRE_CLASSIFICATION_COPY} Browsing by type arrives with the next knowledge release. Until then,{" "}
              <Link href="/search" className={link}>search the archive</Link>.
            </p>
          </Card>
          {SOURCE}
        </article>
      </Container>
    );
  }

  const storedType = BROWSE_TYPES[slug];
  const filters = filtersOf(query);
  const page = pageNumber(query.page);
  const result = browse(storedType, letter, filters, page);
  const values = facetValues(storedType);
  if (result === UNAVAILABLE || values === UNAVAILABLE) {
    return (
      <Container width="reading">
        <article>
          <PageHeader trail={trail} title="Lore archive unavailable" />
          <Card><p className="text-fg-2">{UNAVAILABLE_COPY}</p></Card>
        </article>
      </Container>
    );
  }
  const filterQuery = Object.entries(filters).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");
  const letterQuery = letter ? `letter=${encodeURIComponent(letter)}` : "all=1";
  const pageUrl = (n: number) => `/lore/${slug}?${letterQuery}${filterQuery}${n > 1 ? `&page=${n}` : ""}`;
  const backUrl = letter ? letterUrl(slug, letter) : `/lore/${slug}`;

  return (
    <Container width="reading">
      <article>
        <PageHeader
          trail={trail}
          title={heading}
          lede={<>Pages the wiki&apos;s own categories and infoboxes mark as {heading.toLowerCase()}, by name. This archive predates WoW: Forever.</>}
        />

        <div className="space-y-6">
          <nav aria-label="First letter">
            <ul className="flex flex-wrap gap-1 text-sm">
              {LETTERS.map((l) => (
                <li key={l}>
                  <Link href={letterUrl(slug, l)} aria-current={l === letter ? "page" : undefined}
                    className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border font-mono ${l === letter ? "border-accent text-accent" : "border-edge text-fg-2 hover:text-accent"}`}>
                    {l.toUpperCase()}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <BrowseFilters action={`/lore/${slug}`} letter={letter ?? ""} values={values} selected={filters} />

          {result.rows.length === 0 && page > 1 ? (
            <Card>
              <p className="text-fg-2">No more results. <Link href={backUrl} className={link}>Back to the first page</Link></p>
            </Card>
          ) : result.rows.length === 0 ? (
            <Card>
              <p className="text-fg-2">No pages match these filters. <Link href="/search" className={link}>Search the archive</Link></p>
            </Card>
          ) : (
            <section aria-label={`${heading}, by name`}>
              <Card>
                <ul className="grid gap-x-6 sm:grid-cols-2">
                  {result.rows.map((row) => (
                    <li key={row.extId} className="min-w-0">
                      <Link href={`/lore/${loreSlug(row)}`} className={`inline-flex min-h-9 items-center [overflow-wrap:anywhere] ${link}`}>{row.name}</Link>
                    </li>
                  ))}
                </ul>
              </Card>
              <Pager label="Pages" page={page} prevHref={page > 1 ? pageUrl(page - 1) : null} nextHref={result.hasNext ? pageUrl(page + 1) : null} />
            </section>
          )}

          <p className="text-sm text-muted">
            <Link href="/lore" className={link}>About the lore archive</Link>
            {" "}· <Link href="/search" className={link}>Search</Link>
          </p>
        </div>
        {SOURCE}
      </article>
    </Container>
  );
}