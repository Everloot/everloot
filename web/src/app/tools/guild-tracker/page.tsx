import { permanentRedirect } from "next/navigation";

export default function LegacyToolPage() {
  permanentRedirect("/tools/guild-board");
}
