import Link from "next/link";
import { Card, SectionHeading } from "@/components/ui";
import { armoryOn } from "@/lib/armory";
import { playerPagesOn } from "@/lib/player-pages";
import { startTiles } from "@/lib/start-here";
import { ClassSelect, ClassStartLink, StartClassProvider } from "./StartClass";

/** Server-rendered jobs, without images, request-time reads or speculative route prefetches. */
export default function StartHere() {
  return (
    <section aria-labelledby="start-here">
      <SectionHeading id="start-here">Start here</SectionHeading>
      <StartClassProvider>
        <ClassSelect />
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {startTiles(armoryOn(), playerPagesOn()).map((tile) => (
            <li key={tile.key} className="min-w-0">
              <Card className="h-full !p-4">
                <p className="font-semibold">
                  {tile.key === "talents" || tile.key === "class"
                    ? <ClassStartLink tile={tile}>{tile.label}</ClassStartLink>
                    : <Link href={tile.href} prefetch={false} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{tile.label}</Link>}
                </p>
                <p className="mt-1 text-sm text-muted">{tile.note}</p>
              </Card>
            </li>
          ))}
        </ul>
      </StartClassProvider>
    </section>
  );
}
