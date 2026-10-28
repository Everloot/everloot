import type { Metadata } from "next";
import Link from "next/link";
import { Callout, C, H2, List, P, Step, Steps, Table, docLink } from "@/components/docs/blocks";
import { CodeGroup } from "@/components/docs/DocsClient";
import DocPage from "@/components/docs/DocPage";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Install the Everloot addon",
  description: "Download the Everloot addon, put it in the AddOns folder for WoW: Forever, check it is running, use its slash commands and update it.",
  path: "/docs/guides/addon",
});

export default function Page() {
  return (
    <DocPage href="/docs/guides/addon">
      <P>
        The addon is the part of Everloot that runs inside the game. It records what you see while you play and saves
        it to a file on your computer. It only uses the game&apos;s addon interface and never plays your character. It is
        free and open source under the AGPL-3.0.
      </P>
      <Callout kind="note">
        <p>
          The addon is a beta. It has passed automated checks, but testing in the WoW: Forever client is still pending.
          Keep a backup of your save file.
        </p>
      </Callout>

      <H2 id="install">Install it</H2>
      <Steps>
        <Step title="Download the zip" id="download">
          <P>
            Open the <Link href="/addon" className={docLink}>downloads page</Link>. It lists the current addon version, the
            file size and the SHA-256 checksum, so you can check the file is the one we published.
          </P>
        </Step>
        <Step title="Quit the game" id="quit">
          <P>Close WoW: Forever before you move any files.</P>
        </Step>
        <Step title="Extract the zip" id="extract">
          <P>The zip holds one folder, named <C>Everloot</C>.</P>
        </Step>
        <Step title="Move the folder into AddOns" id="move">
          <P>
            Put the <C>Everloot</C> folder in <C>Interface/AddOns</C>, inside the folder of the game version you play,
            which sits under <C>World of Warcraft</C>.
          </P>
          <div className="mt-6">
            <CodeGroup
              tabs={[{ label: "Folder", lang: "text", code: "World of Warcraft/<game version>/Interface/AddOns/Everloot" }]}
            />
          </div>
        </Step>
        <Step title="Start the game and check it is on" id="enable">
          <P>At the character screen, open the AddOns list and check Everloot is ticked. Then log in.</P>
        </Step>
      </Steps>

      <H2 id="check">Check it is running</H2>
      <P>When Everloot loads it prints its status in chat. You can print it again at any time:</P>
      <div className="mt-6">
        <CodeGroup tabs={[{ label: "In game", lang: "text", code: "/everloot status" }]} />
      </div>
      <P>
        The first line gives the addon version. Below it is one line for each part of the addon, saying whether it is
        ready or off, and how many rows of each kind it has recorded. If your client lacks something a part needs, the
        addon switches off only that part and says so there.
      </P>

      <H2 id="commands">Slash commands</H2>
      <P>
        Most commands start with <C>/everloot</C>. Typing it on its own opens the Talents / Raid workspace.
        Left-click the minimap button for that workspace; right-click it for settings. These are the commands the
        addon has:
      </P>
      <Table
        head={["Command", "What it does"]}
        rows={[
          [<C key="planner">/everloot planner [talents|raid]</C>, "Opens the matching planner tab. Copy a plan on the website with Copy for addon, paste it here and choose Import."],
          [<C key="a">/everloot status</C>, "Prints the version and your install id, each part of the addon and how many rows it holds."],
          [<C key="a2">/everloot options</C>, "Opens the addon's settings page, with a switch for each part and what it records."],
          [<C key="b">/everloot version</C>, "Prints the addon version."],
          [<C key="c">/everloot auctions off</C>, <>Turns off auction capture, which is on in a new install. <C>auctions on</C> turns it back on. Type <C>/reload</C> to apply either.</>],
          [<C key="d">/everloot scan</C>, "At the auction house, starts a full scan, like the Scan this house button. At most one scan every 15 minutes, and nothing scans until you ask."],
          [<C key="d2">/everloot scanprompt off</C>, <>Stops the small Scan prices for Everloot prompt that shows when you open the auction house. <C>scanprompt on</C> brings it back. The button and <C>/everloot scan</C> still work.</>],
          [<C key="e">/everloot price [item]</C>, "Prints the price of an item. Shift-click an item into the command, or give its item id."],
          [<C key="e2">/everloot gph start</C>, <>Starts a gold per hour session in a small window. <C>gph pause</C>, <C>gph stop</C> (saves it), <C>gph reset</C>, <C>gph show</C>, <C>gph hide</C>, <C>gph history</C> (the last five) and <C>gph cut on|off</C> (the 5% auction cut). Sessions stay in your file and are never uploaded.</>],
          [<C key="f">/everloot completion on</C>, <>Turns on the completion tracker, which reads your achievements, reputation, titles and completed quests. <C>completion</C> reads now; <C>completion off</C> turns it off and deletes every row it wrote.</>],
          [<C key="g">/everloot census off</C>, <>Turns off the census, which is on in a new install and counts race, class, level and faction, never a name. It deletes every row the census wrote. <C>census</C> says whether it is on; <C>census on</C> turns it back on.</>],
          [<C key="g2">/everloot players on</C>, <>Turns on the players module, the one part that records other players&apos; names: name, realm, race, class, level and guild of characters you target, mouse over or group with. Its rows are sent only from the upload page and can appear on <Link href="/docs/guides/privacy#player-pages" className={docLink}>player pages</Link>. <C>players</C> says whether it is on; <C>players off</C> turns it off and deletes every row it wrote.</>],
          [<C key="h">/everloot addons on</C>, <>Records the list of your installed addons. <C>addons off</C> stops it and deletes every recorded addon row.</>],
          [<C key="i">/everloot talents</C>, "Prints your talent build for each spec group, with a share code."],
          [<C key="j">/everloot plan &lt;share code&gt;</C>, <>Loads a plan from the <Link href="/tools/talents" className={docLink}>talent calculator</Link> and shows it beside the talent window. It is display only. <C>plan</C> reopens the panel, <C>plan hide</C> closes it and <C>plan clear</C> forgets it.</>],
          [<C key="k">/everloot raid</C>, <>Lists the raid buffs missing from each group in your raid. <C>raid code</C> gives a link that opens the raid in the <Link href="/tools/raid" className={docLink}>raid builder</Link>.</>],
          [<C key="l">/everloot selftest</C>, "Checks that the talent calls the addon relies on work in your client, and prints PASS, FAIL, SKIP and INFO lines."],
          [<C key="m">/ask &lt;question&gt;</C>, <>Stores a question of up to 500 characters. The answer shows in chat after you <C>/reload</C>, once the <Link href="/docs/guides/desktop" className={docLink}>Desktop App</Link> has fetched it.</>],
        ]}
      />
      <Callout kind="tip">
        <p>
          In a new install, auction capture and the census are on. The census says so once in chat; an install from
          before the census keeps it off. The completion tracker, the players module and the installed addon list are
          off until you turn them on. Nothing in the addon buys, bids on or posts anything at the auction house.
        </p>
      </Callout>

      <H2 id="auction-house">At the auction house</H2>
      <P>
        The addon adds an <strong>Everloot</strong> tab after Blizzard&apos;s tabs. Click <strong>Scan this house</strong>{" "}
        for a full scan. The tab shows the scan cooldown, whether the last scan is in your save file yet, a{" "}
        <strong>Share now</strong> button that reloads the game so the file is written and the Desktop App can send it,
        and a price lookup. If the tab cannot be added, an <strong>Everloot scan</strong> button takes its place.
      </P>
      <P>
        When a scan is allowed, opening the auction house also shows a small <strong>Scan prices for Everloot</strong>{" "}
        prompt, once per visit. One click scans. It never scans by itself, and <C>/everloot scanprompt off</C> hides it
        for good.
      </P>

      <H2 id="update">Update the addon</H2>
      <P>
        Quit the game, download the newer zip from the <Link href="/addon" className={docLink}>downloads page</Link>, and
        replace the <C>Everloot</C> folder in <C>Interface/AddOns</C> with the new one. Your collected data is not in that
        folder. It is saved in <C>WTF/Account/&lt;account&gt;/SavedVariables/Everloot.lua</C>, so replacing the addon does
        not remove it.
      </P>
      <P>
        If you use the Desktop App, its Addon page shows your installed version against the latest release and can
        install or update the addon for you.
      </P>

      <H2 id="next">Next</H2>
      <List>
        <li>Send what the addon collected: <Link href="/docs/guides/upload" className={docLink}>upload your data</Link>.</li>
        <li>Have it uploaded after every logout: <Link href="/docs/guides/desktop" className={docLink}>the Desktop App</Link>.</li>
        <li>See what an upload carries and what is published: <Link href="/docs/guides/privacy" className={docLink}>privacy and your data</Link>.</li>
        <li>Something not working: <Link href="/docs/guides/troubleshooting" className={docLink}>troubleshooting</Link>.</li>
      </List>
    </DocPage>
  );
}
