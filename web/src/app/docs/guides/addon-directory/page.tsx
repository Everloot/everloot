import type { Metadata } from "next";
import Link from "next/link";
import { C, H2, List, P, docLink } from "@/components/docs/blocks";
import DocPage from "@/components/docs/DocPage";
import { pageMetadata } from "@/lib/seo";

const REPO = "https://github.com/Everloot/everloot";
export const metadata: Metadata = pageMetadata({
  title: "How the addon directory works",
  description: "How Everloot ranks WoW: Forever addons on its two boards, protects anonymous install counts, and checks requests for approved addon pages.",
  path: "/docs/guides/addon-directory",
});

export default function Page() {
  return (
    <DocPage href="/docs/guides/addon-directory">
      <H2 id="projects">The project board</H2>
      <P>
        <Link href="/addons" className={docLink}>Addons</Link> ranks addons and tools made for WoW: Forever by GitHub stars.
        Ties go to more commits in the last 4 weeks, then to the name. You can choose stars gained, commits, newest
        release, recently updated, installs or name instead; missing numbers sort last.
      </P>
      <P>
        Stars gained compares current stars with the oldest daily count kept from the 7 days before the newest one.
        It is counted from the last refresh, not from today. The addon tracker&apos;s Rising board shows the same change.
        Installs are copies of the Everloot addon that reported the addon, shown from 3. A dash means the number is unknown.
      </P>
      <H2 id="popular">The usage board</H2>
      <P>
        <Link href="/addons/popular" className={docLink}>Popular addons</Link> ranks by the share of reporting installs
        that had the addon loaded, out of every install that reported its addons. Counts are all-time. An addon appears
        once three installs report it; Everloot itself is left out. One install is one copy of the Everloot addon,
        not proof of one person. Addon lists are never published row by row, only as counts.
      </P>
      <P>
        Week compares the rank with the board seven days earlier; New means the addon had no published point then.
        The 8-week line shows the share at the end of each week. At every published point, at least three installs
        had the addon loaded. Both the reporting count and the loaded count differ from today and every other
        published point by zero or at least three installs. Unchanged counts can therefore appear; changes of one
        or two stay hidden. This prevents subtracting weeks to single out one or two installs; early on, most weeks stay blank.
      </P>
      <P>
        Stars and the latest release come from GitHub for repositories checked by hand. Everloot does not call
        CurseForge or Wago: those links open the author&apos;s page, or a CurseForge search when the right page has not
        been checked. A usage label on this board does not mean a project has an approved profile.
      </P>
      <H2 id="listing">How to get listed</H2>
      <P>
        A profile page, its title and download links appear only for a project a maintainer checked by hand and added
        to the owner-approved list. Listing is at the maintainer&apos;s discretion and does not change the ranking.
      </P>
      <List>
        <li>Authors, or people with the author&apos;s permission, can use the <a href={`${REPO}/issues/new?template=addon-listing.yml`} className={docLink}>addon listing request</a>. Include the folder name, repository, download page if any, client version, supported clients and a description in your own words.</li>
        <li>To suggest a public project for the tracker, use the <a href={`${REPO}/issues/new?template=ecosystem-project.yml`} className={docLink}>ecosystem project form</a>. A tracker entry does not automatically approve an addon profile.</li>
        <li>To contribute anonymous usage counts, type <C>/everloot addons on</C> in game, play, log out and <Link href="/upload" className={docLink}>upload your save file</Link>. The preview names every addon before you send it.</li>
      </List>
    </DocPage>
  );
}
