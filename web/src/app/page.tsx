import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import type { Metadata } from "next";
import TrackedDownload from "@/components/TrackedDownload";
import JsonLd from "@/components/JsonLd";
import GlintHero from "@/components/glint/GlintHero";
import StartHere from "@/components/start/StartHere";
import HomeTrust from "./HomeTrust";
import { loadCoverageSummary } from "@/lib/coverage-summary";
import { Banner, Card, SectionHeading } from "@/components/ui";
import HomeSearch from "@/components/HomeSearch";
import { ADDON_LIVE_VERIFIED, latestAddonRelease } from "@/lib/addon-release";
import { loadTimeline } from "@/lib/changes";
import { TYPE_LABEL, postPath } from "@kb/changes";
import { longDate } from "@/data/wow-forever";
import { organizationJsonLd, websiteJsonLd } from "@/lib/jsonld";
import { FEED } from "@/lib/seo";
import { launchArt, loadSiteAssets } from "@/lib/game-assets";
import { BannerArt } from "@/components/game/PageBanner";

export const metadata: Metadata = {
  alternates: { canonical: "/", types: FEED },
};

// The promise's numbers come from the stored coverage score, so the page is rebuilt at most every five minutes.
export const revalidate = 300;

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

// Onyxia's Lair: the raid on the cliff on the left, under the text; Onyxia on the right, where a phone's
// crop keeps her. On a phone the hero is taller than the art's shape, so the picture is drawn about 1200 px wide.
const HERO_ART_POSITION = "61% 30%";
const HERO_ART_SIZES = "(min-width: 1024px) 100vw, 1200px";

export default async function Home() {
  // The game's art (loading screen, logo), only when the asset URL is set and the upload has it.
  const assets = await loadSiteAssets();
  const launch = launchArt(assets);
  const addon = latestAddonRelease();
  // What's new: the newest entries the site's own timeline holds, newest first.
  // One line per announcement: loadTimeline already folds the regional copies together.
  const newest = (await loadTimeline()).slice(0, 4);
  const coverage = await loadCoverageSummary();

  return (
    <div className="space-y-18">
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={websiteJsonLd()} />

      {/* The hero: the section banner at full height, over the game's own loading screen.
          The scripts above it would give it the list's top margin; the banner meets the site header instead. */}
      <section aria-labelledby="hero-title" data-launch-banner={launch ? "" : undefined} className="!mt-0">
        <Banner
          hero
          image={launch?.background && <BannerArt art={launch.background} eager position={HERO_ART_POSITION} sizes={HERO_ART_SIZES} />}
          aside={launch && (
            // Keep the game name as text on every screen; the hero uses Everloot's branding.
            <div className="lg:text-center">
              <p className="text-sm font-semibold text-fg lg:text-base">World of Warcraft: Forever</p>
            </div>
          )}
        >
          {/* Glint holds the launch countdown: above the title on a phone, beside it on a wide screen. */}
          <div className="flex flex-col gap-4 xl:flex-row-reverse xl:items-end xl:justify-end xl:gap-12">
            <GlintHero />
            <h1 id="hero-title" className="text-5xl font-bold leading-none tracking-tight text-fg sm:text-7xl">
              Every drop.<br />Every guild.<br /><span className="text-accent">Every reset.</span>
            </h1>
          </div>
          <p className="mt-4 max-w-[40ch] text-lg text-fg-2 sm:mt-6">
            The open WoW: Forever database, written by the addons of the people who play it.
          </p>
          <div className="mt-6 sm:mt-8"><HomeSearch /></div>
        </Banner>
      </section>

      <StartHere />

      {/* The promise with its live numbers, from the stored coverage score. */}
      <HomeTrust summary={coverage} />

      {/* What's new: the site's own clock, dated. The game builds and posts Everloot has seen, and the
          addon that reads them. */}
      <section aria-labelledby="whats-new">
        <SectionHeading id="whats-new" action={<Link href="/changes" className={link}>Every change →</Link>}>What's new</SectionHeading>
        <Card className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <ul className="min-w-0 space-y-2">
            {newest.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-mono text-xs text-muted">{TYPE_LABEL[e.type]}</span>
                {postPath(e) ? (
                  <Link href={postPath(e)!} className="text-blue-post hover:underline underline-offset-4">{e.title}</Link>
                ) : (
                  <span className="text-fg">{e.title}</span>
                )}
                <span className="text-muted">· {longDate(e.at.slice(0, 10))}</span>
              </li>
            ))}
          </ul>
          {addon && (
            <p className="text-sm text-fg-2 md:max-w-[26ch]">
              The addon is <span className="tabular-nums text-fg">{addon.version}</span>.{ADDON_LIVE_VERIFIED ? "" : " Live-client verification is pending."} It reads the
              client and sends what you allow.
            </p>
          )}
        </Card>
      </section>

      <AdSlot slot="inContent" />

      {/* The addon and the desktop app. */}
      <Card as="section" aria-labelledby="get-addon" className="sm:p-12">
        <SectionHeading id="get-addon" note="It records drops, vendors and prices as you play. The desktop app uploads them and brings prices back into the game.">
          Get the addon
        </SectionHeading>
        <div className="flex flex-wrap items-center gap-3">
          {addon
            ? <TrackedDownload href={addon.downloadPath} addon="everloot" to="site" download className="btn btn-primary">Download addon {addon.version}</TrackedDownload>
            : <Link href="/addon" className="btn btn-primary">Get the addon</Link>}
          <Link href="/addon" className="btn">Desktop app</Link>
        </div>
        <p className="mt-4 text-sm text-muted">
          Free and open source. You choose what is shared.{" "}
          <Link href="/addon#why" className={link}>What it records and what you get back</Link>
        </p>
      </Card>
    </div>
  );
}
