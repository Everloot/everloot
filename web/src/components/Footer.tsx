import Link from "next/link";
import { SOCIAL_PROFILES } from "@/lib/social";
import { CONTACT_EMAIL, DISCORD_INVITE, OPERATOR, SITE_BLURB } from "@/lib/jsonld";
import { deployedSha, REPO_URL, sourceUrl } from "@/lib/source";
import { BETA, LAUNCH, longDate } from "@/data/wow-forever";
import { CookiePreferencesButton } from "./CookieConsent";
import FooterGlint from "./glint/FooterGlint";

/** `plain` marks a same-origin file the router should not prefetch, such as a feed. */
type Item = { label: string; href: string; external?: boolean; plain?: boolean };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Browse",
    items: [
      { label: "Database", href: "/database" },
      { label: "World map", href: "/map" },
      { label: "Changes", href: "/changes" },
      { label: "News", href: "/news" },
      { label: "Lore archive", href: "/lore" },
      { label: "Addons", href: "/addons" },
    ],
  },
  {
    title: "Data and API",
    items: [
      { label: "Get the addon", href: "/addon" },
      { label: "Upload addon data", href: "/upload" },
      { label: "Docs, API and MCP", href: "/docs" },
      { label: "How we count", href: "/methodology" },
      { label: "Data policy", href: `${REPO_URL}/blob/main/docs/DATA_POLICY.md`, external: true },
      { label: "Changes feed (RSS)", href: "/changes/feed.xml", plain: true },
      { label: "News feed (RSS)", href: "/news/feed.xml", plain: true },
    ],
  },
  {
    title: "Project",
    items: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
      { label: "Discord", href: DISCORD_INVITE, external: true },
      { label: "GitHub", href: REPO_URL, external: true },
      ...SOCIAL_PROFILES.map((profile) => ({ ...profile, external: true })),
      { label: "Contributing", href: `${REPO_URL}/blob/main/CONTRIBUTING.md`, external: true },
      { label: "Security", href: "/security" },
    ],
  },
];

const LEGAL: Item[] = [
  { label: "Privacy policy", href: "/privacy" },
  { label: "Terms of use", href: "/terms" },
  { label: "Your privacy choices", href: "/privacy#choices" },
  { label: "Copyright and takedown", href: "/terms#takedown" },
  { label: "Trademarks", href: "/terms#trademarks" },
  { label: "Accessibility", href: "/accessibility" },
];

/** A group's links, with the deployed commit's Source link after the data links. */
const groupItems = (group: (typeof GROUPS)[number]): Item[] =>
  group.title === "Data and API" ? [...group.items, { label: "Source", href: sourceUrl(), external: true }] : group.items;

const itemClass = "inline-flex min-h-8 items-center text-meta text-fg-2 hover:text-accent transition-colors md:min-h-6";
const legalClass = "inline-flex min-h-6 items-center hover:text-accent transition-colors";
const iconClass = "inline-flex h-8 w-8 items-center justify-center rounded-control text-fg-2 hover:text-accent transition-colors";

function FooterLink({ item, className = itemClass }: { item: Item; className?: string }) {
  if (item.external) return <a href={item.href} rel="noopener" className={className}>{item.label}</a>;
  if (item.plain) return <a href={item.href} className={className}>{item.label}</a>;
  return <Link href={item.href} className={className}>{item.label}</Link>;
}

/**
 * The site footer: two slim rows. The first has the wordmark (Glint perched on the footer's edge above it), the
 * tagline, the link groups and the Discord and GitHub icons; on a phone each group folds into a small disclosure.
 * The second, small and muted, has the legal links, the cookie choices, the one site-wide credit line, the operator,
 * licence and build. The full trademark notice and credits are a link away, on /terms#trademarks and /methodology#credits.
 */
export default function Footer() {
  const now = new Date();
  const year = now.getFullYear();
  // Once the beta's last day has passed (UTC), the sentence says so; the launch sentence stays until it happens.
  const betaOver = now.toISOString().slice(0, 10) > BETA.endsOn;
  const sha = deployedSha();
  return (
    <footer className="mt-24 border-t border-line">
      {/* The data column's width and gutters, like the header, so its edges line up with the data tables. */}
      <div className="relative mx-auto max-w-data px-4 lg:px-6">
        <FooterGlint />
        <nav aria-label="Footer">
          <div className="flex flex-col gap-2 py-3 md:flex-row md:items-start md:gap-8">
            <div className="flex items-start justify-between gap-4 md:block md:w-56 md:shrink-0">
              <div>
                <Link href="/" className="inline-flex min-h-8 items-center gap-2 font-bold tracking-tight text-fg">
                  <svg aria-hidden="true" viewBox="8 8 48 48" width="14" height="14" className="text-accent">
                    <path d="M32 12 52 32 32 52 12 32Z" fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
                  </svg>
                  everloot
                </Link>
                <p className="text-meta text-fg-2">{SITE_BLURB}</p>
              </div>
              <Social className="flex shrink-0 md:hidden" />
            </div>
            {/* Wide screens: each group on one line, its name first. */}
            <div className="hidden min-w-0 flex-1 md:block">
              {GROUPS.map((group) => (
                <div key={group.title} className="flex flex-wrap items-baseline gap-x-4">
                  <h2 className="w-24 shrink-0 font-mono text-xs text-muted">{group.title}</h2>
                  <ul className="flex min-w-0 flex-1 flex-wrap gap-x-4">
                    {groupItems(group).map((item) => <li key={item.href}><FooterLink item={item} /></li>)}
                  </ul>
                </div>
              ))}
            </div>
            {/* Phones: each group folds into a disclosure. */}
            <div className="flex flex-wrap gap-x-6 md:hidden">
              {GROUPS.map((group) => (
                <details key={group.title} className="group">
                  <summary className="inline-flex min-h-8 cursor-pointer items-center gap-1 font-mono text-xs text-muted hover:text-fg-2 transition-colors">
                    {group.title}
                    <svg aria-hidden="true" viewBox="0 0 10 6" width="10" height="6" className="group-open:rotate-180"><path d="m1 1 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
                  </summary>
                  <ul className="pop pb-2">
                    {groupItems(group).map((item) => <li key={item.href}><FooterLink item={item} /></li>)}
                  </ul>
                </details>
              ))}
            </div>
            <Social className="hidden shrink-0 md:flex" />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 border-t border-line py-1 text-xs text-muted">
            <h2 className="sr-only">Legal</h2>
            <ul className="flex flex-wrap items-center gap-x-4">
              {LEGAL.map((item) => <li key={item.href}><FooterLink item={item} className={legalClass} /></li>)}
              <li className="text-xs [&>button]:min-h-6 [&>button]:text-xs [&>button]:text-muted"><CookiePreferencesButton /></li>
            </ul>
          </div>
        </nav>
        <div className="space-y-0.5 pb-3 text-xs leading-relaxed text-muted">
          {/* The site's own clock: the beta the data comes from, and the launch it is for. */}
          <p data-site-dates>
            The beta {betaOver ? "ran" : "runs"} until {longDate(BETA.endsOn)}, and the game launches {longDate(LAUNCH.date)}.
          </p>
          <SiteCredit />
          <p>
            &copy; {year} {OPERATOR}. Code AGPL-3.0.
            {sha && <> Build <a href={sourceUrl()} rel="noopener" className="font-mono hover:text-accent transition-colors">{sha.slice(0, 7)}</a>.</>}
            {" "}Contact: <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-accent transition-colors">{CONTACT_EMAIL}</a>
          </p>
        </div>
      </div>
    </footer>
  );
}

/**
 * The site-wide credit: it stands in for a per-page credit line (docs/DATA_POLICY.md). The footer carries it, and
 * so does the map's sidebar, because the full-screen map has no footer.
 */
export function SiteCredit() {
  return (
    <p data-site-credit>
      Game data and art &copy; Blizzard Entertainment · Everloot data CC BY-SA 4.0 · Item and quest names from the Warcraft Wiki
      (CC BY-SA 4.0) · <Link href="/methodology#credits" className="text-fg-2 underline underline-offset-4 hover:text-accent transition-colors">Credits</Link>
    </p>
  );
}

function Social({ className }: { className: string }) {
  return (
    <ul aria-label="Everloot elsewhere" className={`${className} items-center gap-1`}>
      <li>
        <a href={DISCORD_INVITE} rel="noopener" aria-label="Discord" className={iconClass}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
          </svg>
        </a>
      </li>
      <li>
        <a href={REPO_URL} rel="noopener" aria-label="GitHub" className={iconClass}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
        </a>
      </li>
    </ul>
  );
}
