import type { Metadata } from "next";
import Link from "next/link";
import { CREDIT_LINE, GAME_DATA_CREDIT, LICENCE, LICENCE_URL } from "@everloot/protocol";
import { Callout, C, H2, H3, List, P, Table, docLink } from "@/components/docs/blocks";
import { CodeGroup } from "@/components/docs/DocsClient";
import DocPage from "@/components/docs/DocPage";
import { ANON_PAGE, ANON_PER_HOUR, guardOn, KEY_PAGE, KEY_PER_HOUR } from "@/lib/data-guard";
import { BULK_URL } from "@/lib/docs/connect-data";
import { pageMetadata } from "@/lib/seo";
import { REPO_URL } from "@/lib/source";
import { CURL_FIRST, CURL_KEY, CURL_SKINNING, JS, OUTPUT, PY, ROW } from "./samples";

export const metadata: Metadata = pageMetadata({
  title: "Use the data in your addon",
  description: "For addon authors: the licence and credit line for Everloot data, three ways to get it, a skinning loot recipe, and how to build an offline pack.",
  path: "/docs/addon-authors",
});

export default function AddonAuthorsPage() {
  // Read at build time, as on Limits and keys: turning the guard on takes a redeploy, which rebuilds this page too.
  const guard = guardOn();
  return (
    <DocPage href="/docs/addon-authors">
      <P>
        A WoW addon cannot fetch from the web while it runs, so an addon that uses Everloot data ships it inside the addon: an
        offline pack, a Lua file you build outside the game. This page says what you may put in a pack, how to get the data,
        and what to keep when you do.
      </P>

      <H2 id="what-data">What data exists</H2>
      <P>
        Everloot has two kinds of data, and they have different owners.
      </P>
      <Table
        head={["Kind", "What it is", "Licence", "Where it is"]}
        rows={[
          [
            "Observed",
            "What players saw in game and uploaded with the addon: loot windows, vendor lists, NPC sightings, quests and more. Plus the facts and rates the site derives from them.",
            <><a href={LICENCE_URL} rel="noopener" className={docLink}>{LICENCE}</a>, credited to Everloot contributors.</>,
            <>The records API, the open data export, the bulk files, and the site&apos;s pages.</>,
          ],
          [
            "Game files",
            "What the game's own files say for one build: item classes and slots, zones, flight paths and similar.",
            "Blizzard's. Not under Everloot's licence.",
            <>Labelled <C>Found in game files, unconfirmed</C> with the build. Answers carry a <C>gameData</C> notice instead of the credit line.</>,
          ],
        ]}
      />
      <P>
        The licence terms are in <Link href="/docs/licence" className={docLink}>Licence and credit</Link>, the binding text in
        the <Link href="/terms#licences" className={docLink}>terms</Link>, and where each source comes from in{" "}
        <a href={`${REPO_URL}/blob/main/docs/DATA_POLICY.md`} rel="noopener" className={docLink}>DATA_POLICY.md</a>. The open data
        export keeps the two kinds in separate folders, <C>observed/</C> and <C>game-files/</C>, so a file&apos;s licence is
        never mixed. See <a href={`${REPO_URL}/blob/main/docs/OPEN_DATA.md`} rel="noopener" className={docLink}>OPEN_DATA.md</a>.
        This is our reading of the rules, not legal advice.
      </P>

      <H2 id="credit">The credit line</H2>
      <P>Use this line wherever the data is shown or shipped. The API sends it in <C>attribution.credit</C> and in the <C>X-Everloot-Credit</C> header.</P>
      <div className="mt-6">
        <CodeGroup title="Credit line" tabs={[{ label: "Text", lang: "text", code: CREDIT_LINE }]} />
      </div>
      <List>
        <li>
          {LICENCE} also asks that what you build from the data is shared under the same licence. The licence page says the
          same. If you are not sure how that applies to an addon, ask before you pick a licence for it.
        </li>
        <li>
          If your pack holds game-file data, credit Blizzard as the answer&apos;s <C>gameData</C> notice says. Its <C>credit</C> field reads:
          &quot;{GAME_DATA_CREDIT}&quot;
        </li>
        <li>The Everloot name and logo are not licensed. Say your addon uses Everloot data, but give it its own name.</li>
      </List>

      <H2 id="three-ways">Three ways to get it</H2>

      <H3 id="records-api">1. The records API</H3>
      <P>
        <Link href="/docs/api/corpus-public" className={docLink}><C>GET /api/corpus/public</C></Link> returns the records
        players uploaded, without names. It holds every public record kind, single reports included. Pass <C>kinds</C> to pick
        kinds, comma separated, and <C>limit</C> for the page size.
      </P>
      <div className="mt-6">
        <CodeGroup title="The first page of loot records" tabs={[{ label: "cURL", lang: "bash", code: CURL_FIRST }]} />
      </div>
      <List>
        <li>
          <strong>Paging.</strong> The answer has <C>total</C>, <C>offset</C>, <C>limit</C> and <C>next</C>. While <C>next</C> holds an
          address, fetch it. When it is <C>null</C>, you have everything.
        </li>
        <li>
          <strong>Consistency.</strong> The answer has <C>dataAsOf</C>, when the records were current. The snapshot behind the feed is
          rebuilt about every ten minutes. If <C>dataAsOf</C> changes between two pages, the pages come from different snapshots:
          throw them away and start again from the first page.
        </li>
        <li>
          <strong>Errors.</strong> An unknown kind is <C>400</C>. Storage that cannot be read is <C>503</C>, and an empty list is then
          unknown, not zero. Over a limit is <C>429</C> with a <C>retry-after</C> header in seconds.
        </li>
        <li>
          <strong>Credit.</strong> Every page has the <C>attribution</C> block: the licence, the credit line, and the terms.
        </li>
      </List>

      <H3 id="free-key">2. A free key</H3>
      <P>
        You do not need an account to read the feed. {guard
          ? <>Without a key, the feed shares {ANON_PER_HOUR} requests per hour for each IP address with the drop list, <C>/api/items</C> and <C>/api/edges</C>, and a page holds at most {ANON_PAGE} records. A free key gives {KEY_PER_HOUR.toLocaleString("en-US")} requests per hour for your account and {KEY_PAGE.toLocaleString("en-US")} records a page.</>
          : <>Keys are not switched on yet, and nothing needs one. When they are, <Link href="/docs/api/keys" className={docLink}>Limits and keys</Link> lists the limits.</>}
        {" "}Make a key on <Link href="/docs/api/keys" className={docLink}>Limits and keys</Link> and send it as a bearer token.
        A key reads the same data, faster. It opens nothing extra.
      </P>
      <div className="mt-6">
        <CodeGroup title="The same read with a key" tabs={[{ label: "cURL", lang: "bash", code: CURL_KEY }]} />
      </div>
      <P>
        Keep the key out of anything you ship. A pack is built on your machine, so the key never needs to be in the addon.
      </P>

      <H3 id="files">3. Files</H3>
      <P>Two sets of files hold a copy of the data, so you do not have to page through the API.</P>
      <List>
        <li>
          <strong>The open data export</strong> is only what 3 or more installs agree on, one fact per line, with the game-file layer
          in its own folder. Exports are made by hand, so one can be older than the live site. The page{" "}
          <Link href="/database/download" className={docLink}>/database/download</Link> lists the newest one with its date and
          counts. It says &quot;No export to download yet&quot; until one is uploaded. Check it; this page cannot say whether
          one exists today. Its drop-rate files do not hold skinning (see below).
        </li>
        <li>
          <strong>The bulk files</strong> are what the API serves, as one file per dataset. <C>corpus.ndjson</C> holds the same
          records as the feed, single reports included, with the same install pseudonyms.{" "}
          {BULK_URL
            ? <><Link href="/docs/api/data-files" className={docLink}>Data files</Link> says how to find the newest export.</>
            : <>There is no bulk download yet. <Link href="/docs/api/data-files" className={docLink}>Data files</Link> says what is missing.</>}
        </li>
      </List>
      <P>
        For skinning records use the API or the bulk <C>corpus.ndjson</C>. The open data export has no skinning file.
      </P>

      <H2 id="skinning">Recipe: skinning loot</H2>
      <P>
        The addon types every loot window by what opened it. A window opened by Skinning, or by herbalism or mining cast on a
        creature, has <C>lootType</C> <C>&quot;skinning&quot;</C> and the creature in <C>sourceNpcId</C>. Read the loot kind and keep
        those:
      </P>
      <div className="mt-6">
        <CodeGroup title="Loot records that are skinning" tabs={[{ label: "cURL", lang: "bash", code: CURL_SKINNING }]} />
      </div>
      <P>A row looks like this. The values are placeholders; the fields are the ones the loot record schema has.</P>
      <div className="mt-6">
        <CodeGroup title="One loot record" tabs={[{ label: "JSON", lang: "json", code: ROW }]} />
      </div>
      <Table
        head={["Field", "Meaning"]}
        rows={[
          [<C key="a">lootType</C>, <>What opened the window: <C>kill</C>, <C>pickpocket</C>, <C>skinning</C>, <C>gather</C>, <C>disenchant</C>, <C>container</C> or <C>fishing</C>. Absent on windows from older addons; those are never sorted into a type by guessing, so a window without it is not a skinning window.</>],
          [<C key="b">sourceNpcId</C>, "The creature that was skinned. A window with a source object has sourceObjectId instead."],
          [<C key="c">items</C>, <>The items in the window, each <C>itemId</C> and <C>count</C> (1 to 1000). A window can hold none.</>],
          [<C key="d">capturedAt</C>, "When the window opened in game, as an ISO time."],
          [<C key="e">eventId</C>, <>The record&apos;s id within its install. With <C>installId</C> it names one window once.</>],
          [<C key="f">installId</C>, <>A pseudonym for the install: <C>pub-</C> and 32 hex. Stable for one install, never the addon&apos;s own id. It is absent when the server has no key to make one.</>],
          [<C key="g">sourceEvidence</C>, <><C>loot-api</C> when the game&apos;s loot API named the source. The site counts only those windows.</>],
        ]}
      />
      <Callout kind="note">
        <p>
          <strong>One install is a single report.</strong> A row is one install&apos;s word. The site states a fact only when 3
          installs agree, and so should you. Count distinct <C>installId</C> values per creature, not rows: one player skinning
          the same creature fifty times is one install. A creature with fewer than 3 installs is unconfirmed. Ship it
          labelled so, or leave it out.
        </p>
      </Callout>
      <P>The scripts below read every loot record, keep the skinning windows and count them per creature, with the installs behind each count.</P>
      <div className="mt-6">
        <CodeGroup title="skinning" tabs={[{ label: "JavaScript", lang: "js", code: JS }, { label: "Python", lang: "python", code: PY }]} />
      </div>
      <P>Both write <C>skinning.json</C>. With placeholder values it looks like this:</P>
      <div className="mt-6">
        <CodeGroup title="skinning.json" tabs={[{ label: "Output", lang: "json", code: OUTPUT }]} />
      </div>
      <P>
        An empty <C>creatures</C> list is a real answer: nobody has uploaded a skinning window the feed holds yet. It is not a
        measured zero.
      </P>

      <H2 id="drop-rates">Why the site shows no skinning drop rates</H2>
      <P>
        The drop rates on the site, in <C>/api/rollups/drops</C> and in the open data export leave skinning out on purpose. A
        rate is the windows with an item divided by the loot windows opened on the source. Only windows with no type
        and the three that open on the source itself (kill, gather, fishing) count toward it. In the code&apos;s words,
        pick-pocket, skinning, disenchant and container windows wait for their own tables, so they never count in a kill&apos;s
        denominator. A skinning window opens on the same creature as the kill, so counting it would change what a kill&apos;s rate
        divides by. See <C>countsAsKillOrGather</C> in{" "}
        <a href={`${REPO_URL}/blob/main/kb/src/drop-rollup.ts`} rel="noopener" className={docLink}>kb/src/drop-rollup.ts</a>.
      </P>
      <P>
        That is the site&apos;s choice, not a limit of the data. Skinning windows are in the feed with the type on them. If you
        compute a skinning rate yourself, divide by skinning windows on that creature, not by kills, and say so in your pack.
      </P>

      <H2 id="offline-pack">Build an offline pack responsibly</H2>
      <List>
        <li>
          <strong>Build outside the game.</strong> Run a script like the one above on your machine, turn its output into a Lua table,
          and ship that with the addon.
        </li>
        <li>
          <strong>Refresh on your own schedule, not the player&apos;s.</strong> The feed rebuilds about every ten minutes, so reading it
          more often gains nothing. Rebuild the pack when you release, or on a day you pick, and note the <C>dataAsOf</C> in the
          pack. If you need the whole feed often, use a key or a bulk file rather than paging the API.
        </li>
        <li>
          <strong>Keep the credit.</strong> Put the credit line in the pack file&apos;s header, in your addon&apos;s notes or README, and
          wherever the data is shown to a player. A pack that drops it breaks the licence, and we revoke a key used to republish the data
          without credit.
        </li>
        <li>
          <strong>Do not ship install pseudonyms.</strong> They exist so anyone can count installs without learning an id. Count with
          them, then drop them. A pack needs counts, not <C>pub-</C> values.
        </li>
        <li>
          <strong>Label sample sizes.</strong> Ship the number of windows and installs beside each figure, and which creatures are
          confirmed. A player should be able to tell 3 installs from 300.
        </li>
        <li>
          <strong>Do not turn a gap into a zero.</strong> A creature that is missing from the pack is unknown. Show it as unknown.
        </li>
        <li>
          <strong>Do not mix the licences.</strong> Keep observed data and game-file data apart in the pack, as the export does, so each
          keeps its own credit.
        </li>
        <li>
          <strong>Link back.</strong> A pack shows what was known on one day. Link the page on everloot.app for the current figure.
        </li>
      </List>

      <H2 id="contact">Contact</H2>
      <P>
        Ask a question or request data in{" "}
        <a href={`${REPO_URL}/discussions`} rel="noopener" className={docLink}>GitHub Discussions</a>. Report wrong data or a bug as an{" "}
        <a href={`${REPO_URL}/issues/new/choose`} rel="noopener" className={docLink}>issue</a>. Or write to{" "}
        <a href="mailto:hello@everloot.app" className={docLink}>hello@everloot.app</a> and say what you are building. If you need more
        than the limits allow, that is the place to say so.
      </P>
    </DocPage>
  );
}
