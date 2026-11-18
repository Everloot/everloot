import type { Metadata } from "next";
import Link from "next/link";
import { C, H2, List, P, docLink } from "@/components/docs/blocks";
import DocPage from "@/components/docs/DocPage";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Troubleshooting",
  description: "What to do when the Everloot addon does not load, a part of it is off, an upload is refused, the Desktop App cannot find the game, or the API answers 429.",
  path: "/docs/guides/troubleshooting",
});

export default function Page() {
  return (
    <DocPage href="/docs/guides/troubleshooting">
      <P>
        One heading per problem. If yours is not here, email{" "}
        <a className={docLink} href="mailto:hello@everloot.app">hello@everloot.app</a> with the output of{" "}
        <C>/everloot status</C>.
      </P>

      <H2 id="addon-missing">The addon is not in the AddOns list</H2>
      <List>
        <li>
          Check the path. The folder must be <C>Interface/AddOns/Everloot</C>, with <C>Everloot.toc</C> directly inside it.
          Extracting the zip into a folder of its own can leave you with <C>Everloot/Everloot</C>.
        </li>
        <li>Check it is the AddOns folder of the game version you play: each version under <C>World of Warcraft</C> has its own.</li>
        <li>Restart the game after moving the folder. The list is read at startup.</li>
      </List>

      <H2 id="out-of-date">The AddOns list says it is out of date</H2>
      <P>
        The game is newer than the addon&apos;s version number. Get the newest zip from the{" "}
        <Link href="/addon" className={docLink}>downloads page</Link>. Until a newer one is out, you can tick Load out of date
        AddOns at the top of the list.
      </P>

      <H2 id="module-off">/everloot status says a part is off or disabled</H2>
      <List>
        <li>
          <C>off by toggle</C>: you, or the default, turned it off. The <Link href="/docs/guides/addon#commands" className={docLink}>slash
          commands</Link> turn each part on, then <C>/reload</C>.
        </li>
        <li>
          <C>disabled:</C> followed by a reason: your game client lacks something that part needs, so the addon switched off
          only that part. The rest keeps recording. Send us the line so we can look at it.
        </li>
      </List>

      <H2 id="window-closed">The Everloot window closed</H2>
      <P>
        If you closed it yourself, type <C>/everloot window</C> or left-click the minimap button to reopen it. If the
        window is off, turn on <strong>Everloot window</strong> in <C>/everloot options</C>. You can also run{" "}
        <C>/everloot setup</C> to choose your features again.
      </P>
      <P>
        If chat says &ldquo;the window hit an error and closed until /reload&rdquo;, <C>/everloot status</C> names the error.
        Recording was not affected. Save that output, type <C>/reload</C>, then open the window again with{" "}
        <C>/everloot window</C>. Report it with the{" "}
        <a className={docLink} href="https://github.com/Everloot/everloot/issues/new?template=bug-report.yml">Bug report form</a>,
        including the status output and what you were doing when it closed.
      </P>
      <P>
        &ldquo;This part of Everloot did not load&rdquo; means that view is unavailable; <C>/everloot status</C> says why.
        Include that line in a bug report too.
      </P>

      <H2 id="paused">Chat says a collection is paused at capacity</H2>
      <P>
        Most kinds of record hold at most 2,000 rows in your file. When one is full, the addon stops recording that kind and
        says so once. Nothing already recorded is deleted. Upload the file so those rows count. The addon does not clear sent
        rows from the file by itself yet, so the kind stays paused; email us if you hit this.
      </P>

      <H2 id="upload-refused">The upload page refuses records</H2>
      <List>
        <li>The preview lists what it holds back: older records without event ids, named records you did not tick, and invalid ones. Those are not sent.</li>
        <li>After sending, the receipt says what was accepted and gives the reason for each refusal.</li>
        <li>Named records need a verified grant. See <Link href="/docs/guides/upload#get-a-grant" className={docLink}>Get a sharing grant</Link>.</li>
        <li>If the connection drops, keep your file and press Resume upload. Batches already confirmed are kept.</li>
      </List>

      <H2 id="nothing-shows">I uploaded, and nothing new shows on the site</H2>
      <P>
        A fact appears only once 3 installs have reported it the same way, and the published data is rebuilt about every ten
        minutes. Your records are counted; they wait for others to agree. See{" "}
        <Link href="/docs/how-it-works#three-installs" className={docLink}>How Everloot works</Link>.
      </P>

      <H2 id="desktop-folder">The Desktop App cannot find the game</H2>
      <P>
        Browse to the folder of your game version that holds <C>WTF</C>, under <C>World of Warcraft</C>. The app reads every
        account&apos;s <C>Everloot.lua</C> below it. The file appears only after you have logged out or typed <C>/reload</C>{" "}
        once with the addon on. See <Link href="/docs/guides/desktop#install" className={docLink}>Install the Desktop App</Link>.
      </P>

      <H2 id="rate-limited">The API answers 429</H2>
      <P>
        You used up an hourly allowance. The <C>retry-after</C> header says how many seconds to wait. Without a key, several
        endpoints share one small allowance per address; a free key raises it. See{" "}
        <Link href="/docs/api/keys#limits" className={docLink}>Limits and keys</Link>.
      </P>
    </DocPage>
  );
}
