import { permanentRedirect } from "next/navigation";
import { movedDirectoryHref } from "@/lib/armory-guilds";

/** The guild directory moved to /guilds (308), its filters carried over. */
export const dynamic = "force-dynamic";

export default async function Page(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<never> {
  permanentRedirect(movedDirectoryHref(await props.searchParams));
}
