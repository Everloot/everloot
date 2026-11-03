import type { Metadata } from "next";
import LegacyPerks from "@/components/LegacyPerks";
import { Container, PageHeader } from "@/components/ui";
import { LEGACY_PERKS } from "@/data/game-data/legacy-perks";
import { trailFor } from "@/lib/breadcrumbs";
import { pageMetadata } from "@/lib/seo";

const TITLE = "WoW Forever Legacy Perks";
const lede = "Every Legacy perk tree in the WoW: Forever game files, with each perk's ids, ranks, prerequisites and spend gates. A list to read, not a planner.";
const description = `${lede} Found in game files, unconfirmed.`;

export const metadata: Metadata = pageMetadata({ title: TITLE, description, path: "/tools/legacy" });

export default function LegacyPerksPage() {
  return (
    <Container>
      <PageHeader trail={trailFor("/tools/legacy")!} title={TITLE} lede={lede} />
      <LegacyPerks catalog={LEGACY_PERKS} />
    </Container>
  );
}
