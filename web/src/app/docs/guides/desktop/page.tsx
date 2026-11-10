import type { Metadata } from "next";
import Link from "next/link";
import { Callout, C, H2, List, P, Table, docLink } from "@/components/docs/blocks";
import DocPage from "@/components/docs/DocPage";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "The Everloot Desktop App",
  description: "The optional Everloot Desktop App uploads your addon data after each logout and brings community prices back for your in-game item tooltips.",
  path: "/docs/guides/desktop",
});

export default function Page() {
  return (
    <DocPage href="/docs/guides/desktop">
      <P>
        The Desktop App sits in your system tray beside the game. After you log out or type <C>/reload</C>, it uploads
        what the addon recorded, and it writes community market prices into a small price addon, EverlootPrices, so they
        show in your item tooltips. It is free and open source under the AGPL-3.0.
      </P>
      <Callout kind="note">
        <p>
          The app is optional. The addon works without it, and you can always upload your file by hand on the{" "}
          <Link href="/upload" className={docLink}>upload page</Link>.
        </p>
      </Callout>

      <H2 id="what-it-does">What it does</H2>
      <Table
        head={["Job", "What happens", "When"]}
        rows={[
          ["Upload", "Sends the anonymous events the site has not confirmed yet, and census rows if you allowed them, from the Everloot.lua file of each account.", "After the game writes the file, at logout or /reload."],
          ["Market prices", "Writes community prices for the realms you scanned, and the realms you follow, into the EverlootPrices price addon.", "After each upload, and every hour."],
          ["/ask", "Answers questions you typed with /ask in game, if you turn it on.", "After the game writes the file."],
        ]}
      />
      <H2 id="pages">Pages</H2>
      <Table
        head={["Page", "What it shows and does"]}
        rows={[
          ["Overview", "Upload, prices, /ask and addon status, recent activity and Blizzard changes."],
          ["Chat", "Ask about the game or your characters, with sources. Choose an optional model provider in Assistant setup."],
          ["Characters", "Your characters' gold, gear and progress from the save file on this computer."],
          ["Upload", "Each account file, records and confirmed uploads. Run now, backups and restore."],
          ["Market", "Your scans, the last prices written and realms to follow. Your scanned realms are always included; follow more for their tooltip prices."],
          ["Ask", "Assistant setup, pending in-game /ask questions and recent answers. Private server settings are under Advanced."],
          ["Addon", "Installed and latest versions, checksum-checked install or update in one click, slot addon status and Saved builds sync for /everloot plan."],
          ["Changes", "Blizzard posts, hotfixes and builds from the site's change tracker."],
          ["Log", "What the app did this session, with Pause."],
          ["Settings", "Account, game folder, job switches, Assistant setup, startup and updates. Data on this computer shows storage use and Delete my local data."],
        ]}
      />

      <H2 id="signing-in">Signing in</H2>
      <P>
        Choose <strong>Sign in with everloot.app</strong> during setup or under <strong>Settings &gt; Account</strong>.
        In your browser, sign in with Battle.net and press <strong>Connect</strong>. The app receives an Everloot key;
        it never sees your Battle.net password. You can also paste a key from the{" "}
        <Link href="/docs/api/keys#your-keys" className={docLink}>keys page</Link>.
        Uploads and prices work without signing in.
      </P>
      <P>
        Signing in raises the Chat and in-game <C>/ask</C> limits. A key with <strong>Read my saved builds</strong>
        {" "}brings your saved talent builds into the game from the Addon page. Character links and optional private sync
        need the <C>link:own</C> and <C>sync:own</C> permissions respectively. A key alone does not link a character or turn on private sync. See the{" "}
        <Link href="/docs/guides/account" className={docLink}>account guide</Link> for those choices.
      </P>
      <P>
        Signing in does not upload your local chat transcript, backups or model keys. If you choose a model provider,
        it receives your questions, conversation history and any local character details used to answer.
      </P>
      <P>
        It follows the same rules as the website. The app sends anonymous open-world events, and census rows if you
        allowed the census on its setup screen (the box is ticked until you untick it; a switch in its settings changes
        it later). The public upload never sends named data (guild, gear, gold, collection) or your installed addon list; those stay on your
        computer. Player rows stay there too, unless you turn on <em>Send the player pages with the uploads</em> in its
        settings. Nothing touches the game client.
      </P>

      <H2 id="platforms">Platforms</H2>
      <Table
        head={["System", "File", "Needs"]}
        rows={[
          ["Windows", "Installer, or a portable exe that runs without installing", "Windows 10 or 11, 64-bit"],
          ["macOS", "Disk image", "Apple silicon (M1 or newer), macOS 13 Ventura or later. No Intel build yet."],
          ["Linux", "AppImage", "64-bit x86 Linux"],
        ]}
      />

      <H2 id="install">Install it</H2>
      <List ordered>
        <li>Download the file for your system from the <Link href="/addon" className={docLink}>downloads page</Link>, which lists versions and SHA-256 checksums.</li>
        <li>Open it. The builds are not code-signed yet, so your system warns you the first time. That is expected for now.</li>
        <li>On first run the app shows what leaves your computer and looks for your World of Warcraft folder. If it cannot find it, browse to the product folder that holds <C>WTF</C>.</li>
        <li>Press <strong>Start</strong>. The app runs nothing until you do.</li>
      </List>
      <Callout kind="warning">
        <p>
          Windows shows &quot;Windows protected your PC&quot;: choose More info, then Run anyway. On macOS, open System
          Settings, Privacy &amp; Security and choose Open Anyway (on macOS 14 and earlier, right-click the app and choose
          Open). On Linux, make the AppImage executable with <C>chmod +x</C>, then run it; some distributions need FUSE 2
          installed. To check a download, compare its SHA-256 with the one on the downloads page.
        </p>
      </Callout>

      <H2 id="optional">Where it is optional</H2>
      <P>
        You do not need the app to use the addon, to upload, or to read anything on the site. It saves two chores:
        choosing your file after each play session, and keeping community prices fresh in your tooltips.
      </P>
      <P>
        Closing the window keeps the app in the tray. On Windows installs, the app downloads updates itself and
        installs them when you restart it.
      </P>

      <H2 id="next">Next</H2>
      <List>
        <li><Link href="/docs/guides/upload" className={docLink}>Upload your data</Link> by hand instead.</li>
        <li><Link href="/docs/guides/privacy" className={docLink}>Privacy and your data</Link>: what an upload carries.</li>
        <li><Link href="/docs/guides/troubleshooting" className={docLink}>Troubleshooting</Link>: when the app cannot find the game, or an upload is refused.</li>
      </List>
    </DocPage>
  );
}
