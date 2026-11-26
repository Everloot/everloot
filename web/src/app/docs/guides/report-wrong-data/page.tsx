import type { Metadata } from "next";
import Link from "next/link";
import { H2, List, P, docLink } from "@/components/docs/blocks";
import DocPage from "@/components/docs/DocPage";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Report wrong data",
  description: "Report a drop, price, vendor, recipe or lore page that differs from WoW: Forever: what evidence to include, where to send it and what happens next.",
  path: "/docs/guides/report-wrong-data",
});

export default function Page() {
  return (
    <DocPage href="/docs/guides/report-wrong-data">
      <H2 id="what">What counts as wrong data</H2>
      <P>
        A drop, price, vendor, recipe or lore page may disagree with what you saw in WoW: Forever. Report the specific
        mismatch, including a wrong name or location. A missing fact is not a measured zero, and an observed drop rate
        is a sample, not a promise of what your next kill will drop.
      </P>
      <H2 id="include">What to include</H2>
      <List>
        <li>The Everloot page URL.</li>
        <li>What the page shows.</li>
        <li>What you saw yourself in the game, in your own words. Data copied from other sites cannot be used.</li>
        <li>Where you saw it: the zone and coordinates if you have them.</li>
        <li>Your realm and the date of the observation, so a maintainer can distinguish houses, versions and older reports.</li>
      </List>
      <H2 id="send">Where the report goes</H2>
      <P>
        Use the <a href="https://github.com/Everloot/everloot/issues/new?template=wrong-data.yml" className={docLink}>Wrong data issue form</a>.
        Every database page has a Report wrong data link under its summary that opens the form with the page, its type, its
        id and the game build already filled in.
        GitHub issues are public. Keep private information out of them; use <Link href="/contact" className={docLink}>contact</Link> for anything private.
      </P>
      <H2 id="next">What happens next</H2>
      <P>
        A maintainer reads the report and checks it against the source data. A fact changes only when the data does;
        filing a report does not immediately replace a rate or bypass the agreement rules. Player-reported facts
        normally need three installs to agree before publication. The <Link href="/docs/how-it-works" className={docLink}>data guide</Link> explains the sources and their labels.
      </P>
    </DocPage>
  );
}
