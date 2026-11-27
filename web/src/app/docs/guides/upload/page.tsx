import type { Metadata } from "next";
import Link from "@/components/Link";
import { Callout, C, H2, List, P, Step, Steps, Table, docLink } from "@/components/docs/blocks";
import { CodeGroup } from "@/components/docs/DocsClient";
import DocPage from "@/components/docs/DocPage";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Upload your data",
  description: "Send what the Everloot addon collected, from the upload page in your browser or through the Desktop App. You preview everything before it is sent.",
  path: "/docs/guides/upload",
});

export default function Page() {
  return (
    <DocPage href="/docs/guides/upload">
      <P>
        The addon saves what it sees to a file on your computer. Nothing leaves your computer until you upload it. You
        can do that yourself in the browser, or let the Desktop App do it after each logout. You do not need an account
        either way.
      </P>
      <Callout kind="note">
        <p>
          The addon is a beta. It has passed automated checks, but testing in the WoW: Forever client is still pending.
          Keep a backup of your original file.
        </p>
      </Callout>

      <H2 id="browser">Upload in the browser</H2>
      <Steps>
        <Step title="Log out of the game" id="log-out">
          <P>The game writes the save file when you log out or type <C>/reload</C>. Log out before you pick the file.</P>
        </Step>
        <Step title="Find your file" id="find-file">
          <P>
            The addon saves to <C>Everloot.lua</C> in your account&apos;s SavedVariables folder. Keep a copy somewhere safe
            before you upload.
          </P>
          <div className="mt-6">
            <CodeGroup
              tabs={[{ label: "Path", lang: "text", code: "World of Warcraft/<game version>/WTF/Account/<account>/SavedVariables/Everloot.lua" }]}
            />
          </div>
        </Step>
        <Step title="Choose the file" id="choose">
          <P>
            Open the <Link href="/upload" className={docLink}>upload page</Link>. Drop <C>Everloot.lua</C> on it or press
            Choose file. The file stays on your computer, and the page reads it in your browser. The limit is 20 MB.
          </P>
        </Step>
        <Step title="Read the preview" id="preview">
          <P>
            The page lists each kind of record and how many it will send. It also tells you how many records it holds
            back: older records without event ids, named records you did not tick, and invalid ones. If your file holds
            census rows, player rows or the installed addon list, the preview says so here and counts them.
          </P>
        </Step>
        <Step title="Choose what to share" id="consent">
          <P>
            Anonymous sightings are included. Named categories start unticked, and sharing one needs a verified grant.
            The page does not ask for account credentials.
          </P>
          <Table
            head={["Category", "Needs"]}
            rows={[
              ["Guild roster, attendance, progression and loot", "Verified officer authority"],
              ["My character's gear", "Verified ownership"],
              ["My character's gold and money events", "Verified ownership"],
              ["My collection ownership and completion progress", "Verified ownership"],
            ]}
          />
          <P>
            Everloot issues scoped grants after reviewing officer or owner evidence. An addon claim token is not
            verification. Without a grant, named records stay out of the upload. Paste a grant in{" "}
            <strong>Verification grants</strong> on the upload page; how to get one is{" "}
            <a href="#get-a-grant" className={docLink}>below</a>.
          </P>
        </Step>
        <Step title="Send" id="send">
          <P>
            Press Send upload. The page sends the file in batches and moves on only when the server confirms each one. If
            the connection drops, keep your file and press Resume upload: batches already confirmed are kept, and
            reselecting the same file safely retries the same events.
          </P>
        </Step>
      </Steps>

      <H2 id="desktop">Upload with the Desktop App</H2>
      <P>
        The <Link href="/docs/guides/desktop" className={docLink}>Desktop App</Link> finds your save files, then uploads
        after every logout or <C>/reload</C>. It sends anonymous open-world events, and census rows if you allowed the
        census on its setup screen or in its settings. It never sends named data (guild, gear, gold, collection) or the
        installed addon list. Those stay on your computer, so if you want to share them, use the upload page. Player rows
        stay there as well, unless you turn on <em>Send the player pages with the uploads</em> in the app&apos;s settings.
      </P>

      <H2 id="recorder">Upload a Polestar Recorder file</H2>
      <P>
        You can send a recording without installing Everloot&apos;s addon. If you play with the{" "}
        <a href="https://github.com/fitzforge/polestar" rel="noopener" className={docLink}>Polestar Recorder</a>, choose its{" "}
        <C>Polestar_Recorder.lua</C> on the <Link href="/upload" className={docLink}>upload page</Link>, the same way as{" "}
        <C>Everloot.lua</C>. You need no account.
      </P>
      <List>
        <li>Your browser converts the file, one session at a time, and the preview shows what it found. Nothing is sent before you press Send.</li>
        <li>What goes out is NPC positions, quests, loot, dungeon entrances, boss encounters and treasures. Character names, realms, session names and notes typed in game stay on your computer.</li>
        <li>It is a report, not a fact. A fact from a Recorder file is shown only when three different characters, uploading from three different addresses, report it. Your own alts, or two uploads from one connection, count as one reporter.</li>
        <li>Loot windows from a Recorder file are counted and kept out of the drop rates, because the file does not say what the loot came from. The pages say how many were reported and are not in the rates yet.</li>
      </List>

      <H2 id="get-a-grant">Get a sharing grant</H2>
      <P>
        A grant is how Everloot knows you may publish named data: you are an officer of the guild, or you own the
        character. Grants are not made on the site. Signing in does not give you one. They are issued by hand, after
        someone at Everloot has checked your evidence.
      </P>
      <List ordered>
        <li>
          Email <a className={docLink} href="mailto:hello@everloot.app">hello@everloot.app</a>. Say which realm, which guild
          or character, and what you want to share: guild data, a character&apos;s gear or gold, or your collection.
        </li>
        <li>Include your install id, the code in brackets on the first line of <C>/everloot status</C>. A grant works only for that install.</li>
        <li>Say how we can check you are an officer of that guild or the owner of that character. We may ask for more.</li>
        <li>
          We send back a grant: a long code to paste into <strong>Verification grants</strong> on the upload page. Keep it
          private, as you would a password. It has an end date, and you can revoke it yourself at the bottom of the upload page.
        </li>
      </List>
      <P>
        One grant covers one realm and one subject. A guild grant covers guild data; a character grant covers that
        character&apos;s gear and gold; an install grant covers your collection and completion progress.
      </P>

      <H2 id="after">What happens next</H2>
      <P>
        Your anonymous observations are published as individual records, without character names and without the
        addon&apos;s install id; a per-install pseudonym takes its place, so installs can be counted. A fact such as a drop rate, a spawn point or a vendor price appears on the site only after
        3 installs have reported it. Until then it waits. Names appear only in named records you share with a grant, on
        guild boards a guild&apos;s officers publish, and on{" "}
        <Link href="/docs/guides/privacy#player-pages" className={docLink}>player pages</Link>.
      </P>
      <List>
        <li>Guild data publishes only through an authorized officer&apos;s upload.</li>
        <li>Uploaded observations are published under CC BY-SA 4.0, credited to Everloot contributors.</li>
        <li>Installed addon lists and census rows are never published one by one, only as counts.</li>
      </List>
      <P>
        Distinct install ids do not prove independent players, so the site says &quot;3 installs&quot;, not &quot;3 players&quot;.
        See <Link href="/docs/guides/privacy" className={docLink}>privacy and your data</Link> for the full picture.
      </P>

      <H2 id="withdraw">Change your mind</H2>
      <P>
        At the bottom of the upload page, Withdraw named sharing lets you revoke a grant, which withdraws the records it
        authorized. A verified character owner can also opt a character out across guild rosters, attendance, loot, gear
        and gold, and the opt-out stays in effect for later uploads. To have an anonymous upload removed, email{" "}
        <a className={docLink} href="mailto:hello@everloot.app">hello@everloot.app</a>.
      </P>
      <P>
        An upload refused or stuck? See <Link href="/docs/guides/troubleshooting#upload-refused" className={docLink}>Troubleshooting</Link>.
      </P>
    </DocPage>
  );
}
