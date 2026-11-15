import ReferencePage from "@/components/reference/ReferencePage";
import { referenceMetadata } from "@/lib/reference-guides";

export const dynamic = "force-static";
export const metadata = referenceMetadata("raid-prep");

export default function Page() {
  return <ReferencePage slug="raid-prep" />;
}
