import { notFound } from "next/navigation";
import { CARD_SIZE, renderCard } from "@/lib/og-card";
import { LEVELS, parseLevel } from "@/lib/level-unlocks";
export const alt = "WoW Forever level guide on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "error";
export const dynamicParams = false;
export function generateStaticParams() { return LEVELS.map((level) => ({ level: String(level) })); }
export default async function Image({ params }: { params: Promise<{ level: string }> }) {
  const level = parseLevel((await params).level);
  if (level === null) notFound();
  return renderCard({ label: "Everloot", title: `What opens at level ${level}?`, subtitle: "WoW: Forever · Talent points and instance levels from the game files · Training not confirmed yet" });
}
