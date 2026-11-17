import { permanentRedirect } from "next/navigation";
import { armoryBoardPath } from "@/lib/armory";

/** The synced gear board gave way to the armory board, which ranks every character Blizzard's API knows (308). */
export const dynamic = "force-dynamic";

export default function Page(): never {
  permanentRedirect(armoryBoardPath("gear-score"));
}
