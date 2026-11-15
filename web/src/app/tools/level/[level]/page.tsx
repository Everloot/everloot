import { trailFor } from "@/lib/breadcrumbs";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container, PageHeader } from "@/components/ui";
import { loadLevelData } from "@/lib/level-page-data";
import { buildLevelUnlocks, LEVELS, parseLevel } from "@/lib/level-unlocks";
import { pageMetadata } from "@/lib/seo";
import LevelView from "../LevelView";

export const dynamic = "error";
export const dynamicParams = false;
export function generateStaticParams() { return LEVELS.map((level) => ({ level: String(level) })); }
type Props = { params: Promise<{ level: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const level = parseLevel((await params).level);
  if (level === null) return { robots: { index: false, follow: true } };
  const data = await loadLevelData();
  return {
    ...pageMetadata({ title: `What opens at level ${level} in WoW Forever`,
      description: `Just hit level ${level} in WoW: Forever? See talent points and dungeon levels from the game files, with unconfirmed training and zone levels clearly marked.`,
      path: `/tools/level/${level}`, image: `/tools/level/${level}/opengraph-image` }),
    robots: { index: buildLevelUnlocks(data, level).hasData, follow: true },
  };
}
export default async function LevelPage({ params }: Props) {
  const level = parseLevel((await params).level);
  if (level === null) notFound();
  const data = await loadLevelData();
  return <Container>
    <PageHeader title={`What opens at level ${level}?`}
      lede="Talent points and instance levels from the WoW: Forever game files. Training and zone levels are not confirmed yet."
      trail={trailFor(`/tools/level/${level}`)!} />
    <LevelView level={level} unlocks={buildLevelUnlocks(data, level)} classes={data.classes} />
  </Container>;
}
