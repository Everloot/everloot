import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { latestAddonRelease } from "@/lib/addon-release";
import { addonReleaseFor, fetchReleases, fileSize, newestDesktopRelease, RELEASES_PAGE, servedFile } from "@/lib/everloot-releases";
import { REPO_URL } from "@/lib/source";
import JsonLd from "@/components/JsonLd";
import TrackedDownload from "@/components/TrackedDownload";
import { softwareApplicationJsonLd } from "@/lib/jsonld";
import { Badge, Card, Container, Disclosure, PageHeader, SectionHeading } from "@/components/ui";

export const metadata: Metadata = {
  ...pageMetadata({ title: "WoW Forever Addon and Desktop App Downloads", description: "Download the Everloot addon for WoW: Forever and the optional Desktop App for Windows, macOS and Linux, with versions, file sizes and SHA-256 checksums.", path: "/addon" }),
};

// The Desktop App release is read from GitHub, so the page is rebuilt at most once an hour.
export const revalidate = 3600;

const link = "text-accent hover:underline underline-offset-4";
const EXT = "noopener noreferrer";

/** The Desktop App files the page offers, in this order, matched by the end of the artifact name. */
const DESKTOP_KINDS = [
  { suffix: "-win-x64-setup.exe", label: "Windows installer", needs: "Windows 10 or 11, 64-bit", os: "Windows" },
  { suffix: "-win-x64-portable.exe", label: "Windows portable", needs: "Windows 10 or 11, 64-bit. Runs without installing", os: "Windows" },
  { suffix: "-mac-arm64.dmg", label: "macOS disk image", needs: "Apple silicon (M1 or newer), macOS 13 Ventura or later. No Intel build yet", os: "macOS" },
  { suffix: "-linux-x86_64.AppImage", label: "Linux AppImage", needs: "64-bit x86 Linux", os: "Linux" },
];

const LICENCE_URL = "https://www.gnu.org/licenses/agpl-3.0.html";
const ADDON_TEXT = "The addon records what you see in WoW: Forever and saves it to a file on your computer.";
const DESKTOP_TEXT = "The Desktop App is optional and uploads that file for you.";

function Checksum({ name, sha256 }: { name: string; sha256: string | null }) {
  return (
    <li>
      <span className="text-fg-2">{name}</span>
      <code className="block font-mono text-xs text-muted break-all">{sha256 ?? "not reported"}</code>
    </li>
  );
}

export default async function AddonPage() {
  const addon = latestAddonRelease();
  // The zip's name is rebuilt from the version (digits and dots) and encoded, so no name read from disk reaches an href.
  const zipName = addon ? `Everloot-${addon.version}.zip` : "";
  const zipHref = `/downloads/${encodeURIComponent(zipName)}`;
  const served = addon ? servedFile(zipHref) : null;
  const releases = await fetchReleases();
  const addonRelease = addon ? addonReleaseFor(releases, addon.version) : null;
  const addonSums = served && addonRelease?.files.some((file) =>
    file.name === zipName && file.size === served.size && file.sha256 === served.sha256,
  ) ? addonRelease.sums : null;
  const desktop = newestDesktopRelease(releases);
  const desktopFiles = desktop
    ? DESKTOP_KINDS.flatMap((kind) => {
        const file = desktop.files.find((f) => f.name.endsWith(kind.suffix));
        return file ? [{ ...kind, file }] : [];
      })
    : [];

  // One SoftwareApplication per program the page offers, from the same release it lists.
  const systems = [...new Set(desktopFiles.map((f) => f.os))].join(", ");
  return (
    <Container>
      {addon && <JsonLd data={softwareApplicationJsonLd({ name: "Everloot addon", description: ADDON_TEXT, version: addon.version, downloadPath: zipHref, licenceUrl: LICENCE_URL, path: "/addon" })} />}
      {desktop && desktopFiles.length > 0 && <JsonLd data={softwareApplicationJsonLd({ name: "Everloot Desktop App", description: DESKTOP_TEXT, version: desktop.version, downloadPath: desktop.url, licenceUrl: LICENCE_URL, path: "/addon", operatingSystem: systems })} />}
      <PageHeader
        title="Everloot addon and Desktop App"
        lede={`${ADDON_TEXT} ${DESKTOP_TEXT}`}
        trail={[{ name: "Home", path: "/" }, { name: "Get the addon", path: "/addon" }]}
        meta={<><Badge tone="neutral">AGPL-3.0</Badge><span>Free and open source</span></>}
      />

      <div className="space-y-12">
        <div className="grid items-start gap-6 md:grid-cols-2">
          <Card as="section" aria-labelledby="addon" className="space-y-6">
            <SectionHeading
              id="addon"
              note={addon ? `Version ${addon.version}, Alpha${addonRelease ? `, released ${addonRelease.date}` : ""}. For the WoW: Forever client.` : undefined}
            >
              The addon
            </SectionHeading>
            {addon ? (
              <>
                <TrackedDownload className="btn btn-primary" href={zipHref} addon="everloot" to="site" download>
                  Download addon {addon.version}{served ? ` (.zip, ${fileSize(served.size)})` : ""}
                </TrackedDownload>
                <p className="text-sm text-fg-2">Live-client verification is pending. This Alpha includes website talent and raid plan imports; use <code className="font-mono">/everloot</code> to open the planners.</p>
                <div>
                  <SectionHeading as="h3">Install</SectionHeading>
                  <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-2">
                    <li>Quit the game.</li>
                    <li>Extract the zip. It holds one folder, <code className="font-mono">Everloot</code>.</li>
                    <li>
                      Move that folder into <code className="font-mono">Interface/AddOns</code>, inside the folder of the game
                      version you play under <code className="font-mono">World of Warcraft</code>.
                    </li>
                    <li>Start the game, check Everloot is ticked in the AddOns list, and type <code className="font-mono">/everloot status</code> in chat.</li>
                  </ol>
                  <p className="mt-3 text-sm text-fg-2">
                    To send what it collected, log out and pick <code className="font-mono">Everloot.lua</code> on the{" "}
                    <Link href="/upload" className={link}>upload page</Link>, which shows you everything before it is sent. Or let the
                    Desktop App do it.
                  </p>
                </div>
                {served && (
                  <Disclosure summary="SHA-256 checksum">
                    <ul className="text-sm"><Checksum name={zipName} sha256={served.sha256} /></ul>
                    {addonSums && <p className="text-sm"><a className={link} href={addonSums} rel={EXT}>SHA256SUMS</a></p>}
                  </Disclosure>
                )}
                <p className="text-sm text-fg-2">
                  <a className={link} href={addonRelease?.url ?? RELEASES_PAGE} rel={EXT}>Release notes</a>
                  {" · "}
                  <a className={link} href={`${REPO_URL}/tree/main/addon`} rel={EXT}>Source code</a>
                </p>
              </>
            ) : (
              <p className="text-fg-2">
                The addon download is not available on this site right now. It is on the{" "}
                <a className={link} href={RELEASES_PAGE} rel={EXT}>releases page</a>.
              </p>
            )}
          </Card>

          <Card as="section" aria-labelledby="desktop" className="space-y-6">
            <SectionHeading id="desktop" note={desktop ? `Version ${desktop.version}, released ${desktop.date}. Optional.` : undefined}>
              Everloot Desktop App
            </SectionHeading>
            <p className="text-sm text-fg-2">
              After every logout or <code className="font-mono">/reload</code> it uploads the addon&apos;s anonymous observations,
              writes community prices for the realms you scanned into a small companion addon, and can answer <code className="font-mono">/ask</code>{" "}
              questions in game if you turn that on. It shows what leaves your computer and runs nothing until you press Start.
            </p>
            {desktopFiles.length > 0 ? (
              <ul className="space-y-3">
                {desktopFiles.map(({ label, needs, file }) => (
                  <li key={file.name} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <a className="btn text-sm" href={file.url} rel={EXT}>
                      {label} ({fileSize(file.size)})
                    </a>
                    <span className="text-xs text-muted">{needs}.</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-fg-2">
                The download list could not be loaded right now. The files are on the{" "}
                <a className={link} href={RELEASES_PAGE} rel={EXT}>releases page</a>, under the newest{" "}
                <code className="font-mono">desktop-v</code> release.
              </p>
            )}
            <Disclosure summary="The builds are not code-signed yet">
              <div className="space-y-2 text-sm">
                <p>Your system will warn you the first time you open the app. That is expected for now.</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Windows: SmartScreen says &ldquo;Windows protected your PC&rdquo;. Choose More info, then Run anyway.</li>
                  <li>
                    macOS: it says Apple could not verify the app. Open System Settings, Privacy &amp; Security, and choose Open
                    Anyway. On macOS 14 and earlier, right-click the app and choose Open instead.
                  </li>
                  <li>Linux: make the AppImage executable (<code className="font-mono">chmod +x</code>), then run it. Some distributions need FUSE 2 installed.</li>
                </ul>
                <p>
                  If you want to be sure a file is the one we published, compare its SHA-256 with the checksums before opening
                  it: <code className="font-mono">certutil -hashfile FILE SHA256</code> on Windows,{" "}
                  <code className="font-mono">shasum -a 256 FILE</code> on macOS, <code className="font-mono">sha256sum FILE</code> on Linux.
                </p>
              </div>
            </Disclosure>
            {desktop && desktopFiles.length > 0 && (
              <Disclosure summary="SHA-256 checksums">
                <ul className="space-y-1 text-sm">
                  {desktopFiles.map(({ file }) => <Checksum key={file.name} name={file.name} sha256={file.sha256} />)}
                </ul>
                {desktop.sums && <p className="text-sm"><a className={link} href={desktop.sums} rel={EXT}>SHA256SUMS</a></p>}
              </Disclosure>
            )}
            <p className="text-sm text-fg-2">
              <a className={link} href={desktop?.url ?? RELEASES_PAGE} rel={EXT}>Release notes</a>
              {" · "}
              <a className={link} href={`${REPO_URL}/tree/main/desktop`} rel={EXT}>Source code</a>
            </p>
          </Card>
        </div>

        <section id="why" aria-labelledby="why-title" className="scroll-mt-20 space-y-6">
          <div className="max-w-reading">
            <SectionHeading id="why-title">Why run the addon</SectionHeading>
            <p className="text-fg-2">
              Blizzard hides some WoW: Forever details until an item drops, and runs no public test realm. What players
              saw in play is how this site learns what is real. You play as you always do, and the addon writes down what
              the game showed you.
            </p>
          </div>
          <div className="grid items-start gap-6 md:grid-cols-3">
            <Card as="section" aria-labelledby="why-records" className="space-y-3">
              <SectionHeading id="why-records" as="h3">What it records</SectionHeading>
              <ul className="list-disc space-y-2 pl-5 text-sm text-fg-2">
                <li>What a creature, chest or herb gave you, and what vendors sell and trainers teach.</li>
                <li>Prices on the items you look at in the auction house. A full scan runs only when you ask for one.</li>
                <li>Where you stood when an NPC&apos;s window opened (a vendor, a quest giver, a trainer, a flight master), so that NPC can get a place on the map.</li>
                <li>The census: the race, class, level and faction of characters, never a name. It is on in a new install and says so once in chat.</li>
              </ul>
            </Card>
            <Card as="section" aria-labelledby="why-gives" className="space-y-3">
              <SectionHeading id="why-gives" as="h3">What the site gives back</SectionHeading>
              <ul className="list-disc space-y-2 pl-5 text-sm text-fg-2">
                <li>
                  <Link href="/database" className={link}>Database</Link> pages for drops, vendors, quests, NPCs and treasures, each with a row of diamonds for
                  how many installs reported it.
                </li>
                <li>Places on the <Link href="/map" className={link}>map</Link> and in each <Link href="/database/zones" className={link}>zone</Link>, once three installs agree on them.</li>
                <li>With the Desktop App, prices other players scanned on the realms you scanned, in your tooltips.</li>
                <li>The same facts as open data, for the <Link href="/docs/api" className={link}>API</Link> and the <Link href="/docs/mcp" className={link}>MCP server</Link>.</li>
              </ul>
            </Card>
            <Card as="section" aria-labelledby="why-never" className="space-y-3">
              <SectionHeading id="why-never" as="h3">What it never collects or publishes</SectionHeading>
              <ul className="list-disc space-y-2 pl-5 text-sm text-fg-2">
                <li>Your install id, and the address an upload came from, are never published.</li>
                <li>Gold, gear, guild and collection stay on your computer unless you tick them to share on the upload page. Gold per hour sessions never leave it.</li>
                <li>For other players the census reads race, class, level and faction, and nothing else.</li>
                <li>Where you stood when you only targeted an NPC is never used as that NPC&apos;s place.</li>
                <li>The addon never plays your character, and never buys, bids on or posts anything at the auction house.</li>
              </ul>
              <p className="text-sm text-fg-2">
                The one part that records names, the players module, is off until you turn it on. It is described under{" "}
                <a href="#privacy" className={link}>Privacy</a> below.
              </p>
            </Card>
          </div>
          <p className="max-w-reading text-sm text-fg-2">
            Everloot is young, and most pages are still collecting. A fact is shown when three installs agree on it. Until
            then the page says nothing is confirmed instead of showing a number that is not. A drop rate is the share of
            recorded loot windows that held the item. It is not a promise that the item will drop for you.{" "}
            <Link href="/methodology" className={link}>How we count</Link>.
          </p>
        </section>

        <section id="gold-per-hour" aria-labelledby="gold-per-hour-title" className="max-w-reading scroll-mt-20">
          <SectionHeading id="gold-per-hour-title">Gold per hour, now in the addon</SectionHeading>
          <p className="text-sm text-fg-2">
            The gold per hour calculator that was on this site is now in the Everloot addon, so you can work out what a
            farm earns without leaving the game: type <code>/everloot gph start</code>. Sessions stay in your file and are
            never uploaded. Live prices stay on the site, in the <Link href="/tools/auctions" className={link}>Auction House</Link>.
          </p>
        </section>

        <section aria-labelledby="privacy" className="max-w-reading">
          <SectionHeading id="privacy">Privacy</SectionHeading>
          <div className="space-y-2 text-sm text-fg-2">
            <p>
              The addon only writes a file on your computer. Uploads, from the upload page or the app, carry anonymous
              observations; named data stays on your computer unless you choose to share it. The census is on in a new
              install and says so once in chat: it counts the race, class, level and faction of characters you see, never a
              name. <code>/everloot census off</code> turns it off and deletes its rows. The players module is off
              until you type <code>/everloot players on</code>; when you turn it on, the addon records the name, realm,
              race, class, level and guild of your own characters and of players you target, mouse over or group with.
              Those rows can appear on the site&apos;s player pages, and any character can be hidden without an account.
              Read the{" "}
              <Link href="/privacy" className={link}>Privacy Policy</Link> and the{" "}
              <a className={link} href={`${REPO_URL}/blob/main/docs/DATA_POLICY.md`} rel={EXT}>data policy</a>.
            </p>
            <p>
              Every release, including nightly addon builds marked as pre-releases, is on{" "}
              <a className={link} href={RELEASES_PAGE} rel={EXT}>GitHub</a>.
            </p>
          </div>
        </section>
      </div>
    </Container>
  );
}
