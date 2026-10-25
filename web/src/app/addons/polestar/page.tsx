import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { POLESTAR } from "@/data/polestar";
import TrackedDownload from "@/components/TrackedDownload";
import { polestarLive } from "@/lib/polestar-github";
import { trailFor } from "@/lib/breadcrumbs";
import { Container, DataTable, PageHeader, SectionHeading } from "@/components/ui";

export const revalidate = 3600;

export const metadata: Metadata = {
  ...pageMetadata({ title: "Polestar: WoW Forever Leveling Guide Addon", description: "What Polestar is, how to install it, its commands and licence, where it needs help, and its guide packs for WoW: Forever leveling.", path: "/addons/polestar" }),
};

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const button = "btn min-h-11";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Command = (typeof POLESTAR.commands)[number];

export default async function PolestarPage() {
  const live = await polestarLive();
  // A failed refresh throws so the cache keeps serving the last good page; only the build, which has
  // no earlier page, renders the fallback.
  if (!live && process.env.NEXT_PHASE !== "phase-production-build") throw new Error("GitHub unavailable: keep the last good page");
  return (
    <Container width="reading">
      <article>
        <PageHeader
          trail={trailFor("/addons/polestar")!}
          title="Polestar"
          lede="A leveling-guide addon for WoW: Forever. It is free and open source, made by its own authors."
        />
        <div className="space-y-12 text-fg-2">
          <p>
            A guide window tells you the next step, an arrow points the way, and goals tick themselves off as you play. Its
            1 to 60 routes come from a simulator that compares millions of complete routes from each starting zone; the
            guides are written by hand from the route it settles on for each faction. Anyone can add guides of their own as
            a guide pack.
          </p>

          <section aria-labelledby="install" className="space-y-3">
            <SectionHeading id="install">Install</SectionHeading>
            <div className="flex flex-wrap gap-3">
              <TrackedDownload className={button} href={POLESTAR.curseforge} addon="polestar" to="curseforge">CurseForge</TrackedDownload>
              <TrackedDownload className={button} href={POLESTAR.releases} addon="polestar" to="github">GitHub releases</TrackedDownload>
              <a className={button} href={POLESTAR.discord}>Discord</a>
            </div>
            {live ? (
              <p>Latest release <a className={link} href={live.release.url}>{live.release.tag}</a>, published {live.release.date}.</p>
            ) : (
              <p>Live details from GitHub are unavailable right now. The <a className={link} href={POLESTAR.releases}>releases page</a> has the newest version.</p>
            )}
            <p>
              From a download, unzip the Polestar folders straight into the game&apos;s AddOns folder and restart the game
              completely; a /reload does not load new addons.
            </p>
          </section>

          <section aria-labelledby="commands" className="space-y-3">
            <SectionHeading id="commands">Commands</SectionHeading>
            <DataTable<Command>
              caption="Polestar slash commands"
              columns={[
                { key: "command", header: "Command", nowrap: true, cell: ([command]) => <code className="font-mono text-accent">{command}</code> },
                { key: "text", header: "What it does", cell: ([, text]) => <span className="text-fg-2">{text}</span> },
              ]}
              rows={[...POLESTAR.commands]}
              rowKey={([command]) => command}
            />
          </section>

          <section aria-labelledby="packs" className="space-y-3">
            <SectionHeading id="packs">Guide packs</SectionHeading>
            <p>
              A guide pack is someone else&apos;s guides for Polestar, published as its own addon. Polestar ships its own
              guides as a pack too, but does not host or recommend anyone else&apos;s, so Everloot keeps an independent list.
            </p>
            <ul className="space-y-1">
              <li><Link className={link} href="/addons/polestar/packs">Guide packs you can install</Link></li>
              <li><Link className={link} href="/addons/polestar/wanted">Routes and guides worth building</Link></li>
              <li><a className={link} href={POLESTAR.handbook}>Polestar&apos;s handbook for writing a pack</a></li>
            </ul>
          </section>

          <section aria-labelledby="help" className="space-y-3">
            <SectionHeading id="help">Help Polestar</SectionHeading>
            {live ? (
              <>
                {live.helpWanted.length > 0 && (
                  <ul className="list-disc space-y-1 pl-6">
                    {live.helpWanted.map((issue) => (
                      <li key={issue.number}><a className={link} href={issue.url}>#{issue.number} {issue.title}</a></li>
                    ))}
                  </ul>
                )}
                <p>
                  <a className={link} href={POLESTAR.bugReports}>{plural(live.bugReports, "open bug report", "open bug reports")}</a> from
                  players and {plural(live.openIssues, "open issue", "open issues")} in all, <a className={link} href={POLESTAR.issues}>on GitHub</a>.
                  Reports are welcome on the Discord too.
                </p>
              </>
            ) : (
              <p>Live details from GitHub are unavailable right now. Open requests are on <a className={link} href={POLESTAR.issues}>GitHub</a>.</p>
            )}
          </section>

          <section aria-labelledby="licence" className="space-y-3">
            <SectionHeading id="licence">Licence</SectionHeading>
            <p>
              Polestar is GPL-3.0 (<a className={link} href={POLESTAR.license}>LICENSE</a>). An added permission
              (<a className={link} href={POLESTAR.licenseException}>LICENSE-EXCEPTION.md</a>) lets authors publish packs produced
              by its compiler under terms of their choice. It does not cover Polestar&apos;s code or text copied from its own
              guides.
            </p>
          </section>
        </div>

        <p className="mt-12 text-xs text-muted">
          Not affiliated with or endorsed by Polestar&apos;s authors. Everloot&apos;s maintainer contributes to Polestar:{" "}
          <a className={link} href={POLESTAR.maintainerPrs}>their pull requests</a>.
        </p>
      </article>
    </Container>
  );
}
