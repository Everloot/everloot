import Link from "next/link";
import type { ReactNode } from "react";
import Card from "./Card";
import SectionHeading from "./SectionHeading";

/**
 * The "add yours" card under a tool fed by uploads (first on the Auction House): a heading that names what
 * the player can add, one line on how, and the two ways in. The same card on every such tool, so a reader
 * who learned it once knows what it asks.
 */
export default function Contribute({ id, title, note, actions }: { id: string; title: ReactNode; note: ReactNode; actions?: ReactNode }) {
  return (
    <Card as="section" aria-labelledby={id}>
      <SectionHeading id={id} note={note}>{title}</SectionHeading>
      <div className="flex flex-wrap gap-2">
        {actions ?? (
          <>
            <Link href="/addon" className="btn">Get the addon</Link>
            <Link href="/addon#desktop" className="btn">Get the Desktop App</Link>
          </>
        )}
      </div>
    </Card>
  );
}
