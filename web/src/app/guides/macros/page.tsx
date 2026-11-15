import ReferencePage from "@/components/reference/ReferencePage";
import { referenceMetadata } from "@/lib/reference-guides";

export const dynamic = "force-dynamic";
export const metadata = referenceMetadata("macros");

export default function Page() {
  return <ReferencePage slug="macros" />;
}
