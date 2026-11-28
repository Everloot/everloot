import type { Metadata } from "next";
import Link from "@/components/Link";
import { Container, PageHeader } from "@/components/ui";
import { trailFor } from "@/lib/breadcrumbs";
import { pageMetadata } from "@/lib/seo";
import InventoryValue from "./InventoryValue";

const PATH = "/tools/bags/value";
const TITLE = "Inventory Value";
const description = "Estimate the auction value of your WoW: Forever bags or bank from public asking prices on one realm and auction house.";

export const metadata: Metadata = pageMetadata({ title: `WoW Forever ${TITLE}`, description, path: PATH });

export default function InventoryValuePage() {
  return (
    <Container width="reading">
      <PageHeader
        trail={[...trailFor("/tools/bags")!, { name: TITLE, path: PATH }]}
        title={TITLE}
        lede={description}
        actions={<Link href="/tools/bags" className="btn min-h-11">Bag upgrades</Link>}
      />
      <InventoryValue />
    </Container>
  );
}
