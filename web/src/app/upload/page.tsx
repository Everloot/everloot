import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { latestAddonRelease } from "@/lib/addon-release";
import { REPO_URL } from "@/lib/source";
import { playerPagesOn } from "@/lib/player-pages";
import { Card, Container, PageHeader, SectionHeading } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import UploadClient from "./UploadClient";
import TrackedDownload from "@/components/TrackedDownload";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Upload WoW Forever Addon Data", description: "Download the Everloot addon for WoW: Forever and upload what it collected. You preview everything before it is sent, and no account is needed.", path: "/upload" }),
};

const ADDON_DESCRIPTION = "An Alpha addon that records what happens around you while you play, for upload to Everloot.";
const LICENCE_NAME = "AGPL-3.0";
const link = "text-accent hover:underline underline-offset-4";

export default function UploadPage() {
  const addon = latestAddonRelease();
  return (
    <Container width="reading">
      <PageHeader
        title="Upload addon data"
        lede="Collected by the Everloot addon or the Polestar Recorder while you play. You preview exactly what goes out before anything is sent."
        trail={trailFor("/upload")!}
      />
      <div className="space-y-6">
        <p className="text-fg-2">
          Open-world sightings stay anonymous, and guild data publishes only through your officers.
          Uploaded observations are published under CC BY-SA 4.0, credited to Everloot contributors.
        </p>
        <Card as="section" aria-labelledby="collect">
          <SectionHeading id="collect" note={ADDON_DESCRIPTION}>Collect data with Everloot</SectionHeading>
          <div className="space-y-3 text-fg-2">
            {addon ? (
              <>
                <p>Extract the Everloot folder into Interface/AddOns, reload the client, and check /everloot status. Version {addon.version} has passed automated checks; testing in the Forever client is still pending.</p>
                <p><TrackedDownload className={link} href={addon.downloadPath} addon="everloot" to="site" download>Download Alpha addon {addon.version}</TrackedDownload></p>
                <p className="text-sm">Licence: {LICENCE_NAME}. <a className={link} href={REPO_URL} rel="noopener">Source code</a>.</p>
                <p className="text-sm">Checksums, install steps and the Desktop App, which uploads for you after each logout, are on the <Link className={link} href="/addon">downloads page</Link>.</p>
              </>
            ) : (
              <p>The addon download is not available right now.</p>
            )}
            <p className="text-sm">Log out before selecting Everloot.lua from your account’s SavedVariables folder below. Keep a backup. Named records need your explicit sharing choice and verified authority.</p>
          </div>
        </Card>
        <Card as="section" aria-labelledby="recorder">
          <SectionHeading id="recorder" note="You do not need Everloot's addon for this.">Already recording with Polestar?</SectionHeading>
          <div className="space-y-3 text-fg-2">
            <p>
              If you play with the <a className={link} href="https://github.com/fitzforge/polestar" rel="noopener">Polestar Recorder</a>{" "}
              addon, drop its <code className="font-mono">Polestar_Recorder.lua</code> below, from the same SavedVariables folder.
              You do not need an account, and you do not need to install anything else.
            </p>
            <p className="text-sm">
              Your browser reads the file and shows you what it found before anything is sent: NPC positions, quests, loot,
              dungeon entrances, bosses and treasures. Character names, realms, session names and notes stay on your computer.
            </p>
            <p className="text-sm">
              What you send is a report, not a fact. A fact from a Recorder file is shown only when three different characters,
              uploading from three different addresses, report it, so your own alts or a second upload from your connection do
              not count again. Until then the page says it is not confirmed.
            </p>
          </div>
        </Card>
        <p className="text-sm text-fg-2">
          What Everloot publishes and what it refuses is written down in the{" "}
          <a className={link} href={`${REPO_URL}/blob/main/docs/DATA_POLICY.md`} rel="noopener">data policy</a>.
        </p>
        <UploadClient playerPages={playerPagesOn()} />
      </div>
    </Container>
  );
}
