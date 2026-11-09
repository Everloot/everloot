import type { Metadata } from "next";
import Link from "next/link";
import { Callout, C, H2, P, docLink } from "@/components/docs/blocks";
import DocPage from "@/components/docs/DocPage";
import { CONTACT_EMAIL } from "@/lib/jsonld";
import { pageMetadata } from "@/lib/seo";
import { REPO_URL } from "@/lib/source";
import { CREDIT_LINE } from "@everloot/protocol";

export const metadata: Metadata = pageMetadata({
  title: "FAQ",
  description: "Short answers to what players and developers ask about Everloot: cost, accounts and keys, the addon, missing facts, data age, reuse and how to report a mistake.",
  path: "/docs/faq",
});

export default function Page() {
  return (
    <DocPage href="/docs/faq">
      <H2 id="is-it-free">Is Everloot free?</H2>
      <P>
        Browsing is free and needs no account. A few clearly labelled ads pay for hosting. The addon and the Desktop App are free
        and open source under the AGPL-3.0. See <Link href="/addon" className={docLink}>the downloads</Link> and the{" "}
        <Link href="/terms" className={docLink}>terms</Link>.
      </P>

      <H2 id="account-or-key">Do I need an account or an API key?</H2>
      <P>
        Not to read. The website, the API and the MCP server work without an account or a key. There are rate limits, but no
        sign-in wall. A free key raises them. See <Link href="/docs/api/keys" className={docLink}>Limits and keys</Link> and{" "}
        <Link href="/docs/guides/account" className={docLink}>Your account</Link>.
      </P>

      <H2 id="is-the-addon-safe">Is the addon safe?</H2>
      <P>
        The addon records what you see in game and saves it to a file on your computer. Nothing is sent until you upload, and the
        upload page shows you everything first. The source is public, and each download has a SHA-256 checksum so you can verify it. Your
        install id is never published, and anonymous observations carry no character names. Names appear only in records their
        owner shares, on guild boards a guild&apos;s officers publish, and on player pages, which anyone can ask to hide. See{" "}
        <Link href="/docs/guides/privacy" className={docLink}>Privacy and your data</Link>.
      </P>
      <Callout kind="note">
        <p>Everloot is a fan project, not affiliated with or endorsed by Blizzard, so it cannot speak for Blizzard about addon rules.</p>
      </Callout>

      <H2 id="why-is-a-fact-missing">Why is a fact missing?</H2>
      <P>
        A fact appears once three different installs have reported it the same way. If fewer have, the page says it is not
        recorded yet. It does not guess, and it does not show a zero. You can help by playing with the addon and uploading. See{" "}
        <Link href="/docs/how-it-works#three-installs" className={docLink}>How Everloot works</Link>.
      </P>

      <H2 id="what-does-unconfirmed-mean">What does &quot;found in game files, unconfirmed&quot; mean?</H2>
      <P>
        The entry was read from the game&apos;s own files, not seen by players. It exists in that build&apos;s data, but that does
        not mean it is, or will be, in the game. It is labelled with the build it came from until players see it in play. See{" "}
        <Link href="/docs/how-it-works#unconfirmed" className={docLink}>Found in game files, unconfirmed</Link>.
      </P>

      <H2 id="spoilers">Why is something hidden?</H2>
      <P>
        Content found only in the game files, such as a zone that looks unreleased, could spoil things that are not out yet. It is
        hidden until you turn spoilers on. See <Link href="/docs/how-it-works#spoilers" className={docLink}>Spoilers and held-back content</Link>.
      </P>

      <H2 id="how-fresh">How fresh is the data?</H2>
      <P>
        Answers built on player data say how old they are. The corpus API returns <C>dataAsOf</C>, and the snapshot behind it
        changes about every ten minutes. Game-file data is stamped with its build. See{" "}
        <Link href="/docs/how-it-works#data-age" className={docLink}>Data age</Link>.
      </P>

      <H2 id="use-the-data">Can I use the data in my project?</H2>
      <P>
        Yes, with credit. Player data is CC BY-SA 4.0, so what you build from it stays under the same licence. The credit line
        is: {CREDIT_LINE} Blizzard&apos;s icons, text and art are not covered. See{" "}
        <Link href="/docs/licence" className={docLink}>Licence and credit</Link> and the <Link href="/docs/quickstart" className={docLink}>Quickstart</Link>.
      </P>

      <H2 id="use-with-ai">Can I use Everloot with an AI assistant?</H2>
      <P>
        Yes. The MCP server is hosted and needs no sign-in, and every answer carries its source and licence. See{" "}
        <Link href="/docs/mcp/clients" className={docLink}>Connect a client</Link>.
      </P>

      <H2 id="tooltips-on-my-site">Can I show Everloot cards on my own site?</H2>
      <P>
        Yes. One script tag adds a hover card to every link to an Everloot item, NPC, quest or object page. See{" "}
        <Link href="/docs/tooltips" className={docLink}>Embeddable tooltips</Link>.
      </P>

      <H2 id="something-is-wrong">Something is not working</H2>
      <P>
        The addon will not load, a part of it is off, an upload is refused or the API answers 429: see{" "}
        <Link href="/docs/guides/troubleshooting" className={docLink}>Troubleshooting</Link>.
      </P>

      <H2 id="report-a-mistake">How do I report a mistake or contact you?</H2>
      <P>
        Email <a href={`mailto:${CONTACT_EMAIL}`} className={docLink}>{CONTACT_EMAIL}</a> for data corrections, bug reports, privacy
        requests and takedowns, or use the <Link href="/contact" className={docLink}>contact page</Link>. Bugs can also go to{" "}
        <a href={`${REPO_URL}/issues/new/choose`} rel="noopener" className={docLink}>GitHub issues</a>.
      </P>
    </DocPage>
  );
}
