import type { Metadata } from "next";
import Link from "next/link";
import { Callout, C, H2, List, P, Table, docLink } from "@/components/docs/blocks";
import DocPage from "@/components/docs/DocPage";
import AgreementMeter, { AGREEMENT_NEEDED } from "@/components/ui/AgreementMeter";
import { pageMetadata } from "@/lib/seo";
import { REPO_URL } from "@/lib/source";

export const metadata: Metadata = pageMetadata({
  title: "How It Works",
  description: "How a loot window in WoW: Forever becomes a fact on Everloot: the addon, uploads, the 3-install rule, measured zeros, game-file data, spoilers and data age.",
  path: "/docs/how-it-works",
});

export default function Page() {
  return (
    <DocPage href="/docs/how-it-works">
      <P>
        Every fact on Everloot that comes from play starts as something a player saw in game. This page follows one of them,
        say a loot window, from the game to a page on the site. The same rules apply to the website, the API and the MCP server.
      </P>

      <H2 id="record">The addon records</H2>
      <P>
        The Everloot addon notes what happens around you while you play: drops, vendors, auction prices you browse, recipes,
        trainers, gold in and out. It saves them to a file on your computer. Nothing leaves your machine until you upload.
      </P>
      <P>
        The census is on in a new install and says so once in chat. An install from before the census keeps it off.{" "}
        <C>/everloot census off</C> turns it off and deletes its rows. The players module and the list of your installed
        addons are off until you turn them on. Install steps and every switch are in{" "}
        <Link href="/docs/guides/addon" className={docLink}>Install the addon</Link>.
      </P>

      <H2 id="upload">You upload</H2>
      <P>
        You choose when to upload. On the <Link href="/upload" className={docLink}>upload page</Link> you see a preview of
        everything before it is sent. The optional Desktop App can do the same after you log out, and it shows what leaves your
        computer. See <Link href="/docs/guides/upload" className={docLink}>Upload your data</Link>.
      </P>
      <P>
        Uploaded observations are public as anonymous records, with no character names and without your install id. Each
        carries a per-install pseudonym instead, a keyed hash that cannot be turned back into the id, so anyone can check our counts. Names appear only in named records their owner shares (gear, gold, collection), on guild boards
        a guild&apos;s officers publish, and on player pages. What is published, what is never published, and why, is on{" "}
        <Link href="/docs/guides/privacy" className={docLink}>Privacy and your data</Link>.
      </P>

      <H2 id="three-installs">Three installs have to agree</H2>
      <P>
        A drop, a vendor item, a spawn point, a recipe range or a market price appears as a fact only once at least{" "}
        {AGREEMENT_NEEDED} different installs have reported it the same way. For prices and catalog entries, different means
        different upload addresses, with an IPv6 address counted by its /64 block. One household cannot make a fact true on its own.
      </P>
      <P>
        Two kinds of answer follow their own rule. A guild board figure is public when uploads from 2 of that guild&apos;s
        officers agree, each with a verified sharing grant. A character&apos;s gold ledger and a collection&apos;s owned
        list come from that owner&apos;s own shared upload, so no agreement is needed.
      </P>
      <P>On the site you see this as a row of diamonds, one for each install that has reported the fact:</P>
      <Table
        head={["Installs", "Meter", "What it means"]}
        rows={[
          [0, <AgreementMeter key="0" count={0} size="lg" />, "Nobody has reported it."],
          [1, <AgreementMeter key="1" count={1} size="lg" />, "One install has. Not a fact yet."],
          [2, <AgreementMeter key="2" count={2} size="lg" />, "Two installs. Not a fact yet."],
          [3, <AgreementMeter key="3" count={3} size="lg" />, "Three agree. The fact is public."],
        ]}
      />
      <P>Until three agree, the page says so instead of guessing.</P>

      <H2 id="zeros">Unrecorded is not zero</H2>
      <P>
        If nobody has recorded something, the page says <em>unrecorded</em>. A zero appears only when it was measured: for
        example, &quot;0 drops in 40 loot windows&quot; once three installs looted that creature and none of them saw the item.
        A storage outage or a missing source is never shown as zero.
      </P>
      <P>
        A drop rate is the share of recorded loot windows on a creature or object that held the item. A kill nobody looted
        is not counted, because the addon never saw it. The API field for that count is named <C>kills</C>, but it counts
        loot windows.
      </P>

      <H2 id="unconfirmed">Found in game files, unconfirmed</H2>
      <P>
        Some pages, such as the <Link href="/tools/talents" className={docLink}>talent calculator</Link> and the{" "}
        <Link href="/map" className={docLink}>map</Link>, use data a maintainer read from the game&apos;s own files. Blizzard hides some
        item details until an item drops, so the files show what exists and play shows what is real. Everloot keeps the two apart.
      </P>
      <List>
        <li>Every such entry is labelled <strong>found in game files, unconfirmed</strong>. A record there does not mean the thing is, or will be, in the game.</li>
        <li>It is stamped with the build it came from.</li>
        <li>It is Blizzard&apos;s data, shown as facts, and kept apart from Everloot&apos;s own data and licence.</li>
        <li>Only unencrypted data is read. Encrypted content stays out.</li>
        <li>When players later see the same thing in game, the entry shows both: found in the files and seen in play.</li>
      </List>
      <Callout kind="note">
        <p>The three-install rule does not apply to game-file data, because no player has reported it. It still applies to anything players saw, and the two are labelled separately.</p>
      </Callout>

      <H2 id="builds">Builds</H2>
      <P>
        Game-file data is stamped with the build it came from, on the page and in every answer. When Blizzard ships a new build,
        a reviewed change records what moved in the tables Everloot reads. Entries read before launch on 4 November 2026 come from a pre-release build, and each one names it. The <Link href="/changes" className={docLink}>what changed</Link> page
        lists recent Blizzard posts and builds, and the MCP server gives assistants the same list as a resource,{" "}
        <C>everloot://builds</C>.
      </P>

      <H2 id="spoilers">Spoilers and held-back content</H2>
      <P>
        Content found only in the game files can spoil things that have not been released. It is hidden by default behind a
        spoiler switch. For example, a zone that looks unreleased is held back: the <Link href="/map" className={docLink}>map</Link> draws
        it, dashed and labelled unconfirmed, only when you turn spoilers on. The public MCP tool leaves held-back zones out
        altogether.
      </P>

      <H2 id="data-age">Data age</H2>
      <P>
        Answers built on player data say how old they are. The corpus API returns <C>dataAsOf</C>, and MCP answers end with
        the age of the data. The snapshot behind the corpus feed changes about every ten minutes, so check{" "}
        <C>dataAsOf</C> before you trust a number.
      </P>

      <H2 id="more">The full rules</H2>
      <P>
        The shorter version is on <Link href="/methodology" className={docLink}>How we count</Link>. The long one is the{" "}
        <a href={`${REPO_URL}/blob/main/docs/DATA_POLICY.md`} rel="noopener" className={docLink}>data policy</a>.
        Questions players ask most are in the <Link href="/docs/faq" className={docLink}>FAQ</Link>.
      </P>
    </DocPage>
  );
}
