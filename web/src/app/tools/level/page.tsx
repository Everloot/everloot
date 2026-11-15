import Link from "next/link";
import { Container, PageHeader } from "@/components/ui";
import { LEVELS, levelHref } from "@/lib/level-unlocks";
import { pageMetadata } from "@/lib/seo";
export const dynamic = "error";
export const metadata = pageMetadata({ title: "WoW Forever level guide", description: "Choose a level from 1 to 60 to see talent points and instance levels in WoW: Forever. Training and zone levels without supporting data are marked unconfirmed.", path: "/tools/level" });
export default function LevelIndex() {
  return <Container>
    <PageHeader title="What opens at your level?" lede="Choose your level. Share the page with your group, or filter it to your class."
      trail={[{ name: "Home", path: "/" }, { name: "Tools", path: "/tools" }, { name: "Level guide", path: "/tools/level" }]} />
    <ol className="grid grid-cols-5 gap-3 sm:grid-cols-10" aria-label="Levels 1 to 60">
      {LEVELS.map((level) => <li key={level}><Link href={levelHref(level)} aria-label={`Level ${level}`} className="flex min-h-11 items-center justify-center rounded-card border border-line bg-panel text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{level}</Link></li>)}
    </ol>
  </Container>;
}
