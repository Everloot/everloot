import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import { Container, PageHeader } from "@/components/ui";
import { ARMORY_HIDE_PATH, ARMORY_PATH, armoryOn } from "@/lib/armory";
import { armoryStore } from "@/lib/armory-store";
import { ArmoryCredit, armoryMetadata, CharacterFields, first, FormUnreachable, link, newest, NOT_FOUND_METADATA } from "../parts";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  if (!armoryOn()) return NOT_FOUND_METADATA;
  return armoryMetadata({ title: "Hide a character from the armory", description: "Take a WoW: Forever character off Everloot's armory. No account needed.", path: ARMORY_HIDE_PATH });
}

type Search = { region?: string | string[]; name?: string | string[]; surname?: string | string[]; done?: string | string[]; error?: string | string[] };

const ERROR: Record<string, string> = {
  limit: "Too many requests from this connection. Try again in an hour.",
  storage: "We could not save that. Try again in a moment.",
  invalid: "Check the name and the surname: letters only, 2 to 12 for the name and 2 to 24 for the surname.",
};

export default async function ArmoryHidePage(props: { searchParams: Promise<Search> }) {
  if (!armoryOn()) notFound();
  const params = await props.searchParams;
  const done = first(params.done) === "1";
  const error = first(params.error);
  // A store out of reach still draws the form; the read time is then unrecorded.
  const counts = await armoryStore().counts().catch(() => null);

  return (
    <Container width="reading">
      <article className="max-w-xl space-y-6">
        <PageHeader
          trail={[...trailFor("/armory")!, { name: "Hide a character", path: ARMORY_HIDE_PATH }]}
          title="Hide a character"
          lede="Enter the character's region, name and surname. Its armory page, its rankings and its place on its guild's roster are deleted as soon as you send it, and Everloot does not read it from Blizzard again. You do not need an account, and we do not ask who you are."
          meta={<ArmoryCredit at={counts ? newest(counts.map((c) => c.newest)) : null} />}
        />

        {done && <p role="status" className="rounded-card border border-line bg-panel p-4 text-fg">Done. That character is hidden and will not be read again.</p>}
        {counts === null && <FormUnreachable />}
        {error && <p role="alert" className="rounded-card border border-line bg-panel p-4 text-fg">{ERROR[error] ?? ERROR.invalid}</p>}

        <form action="/armory/hide/send" method="post" className="space-y-4">
          <CharacterFields region={first(params.region)} name={first(params.name)} surname={first(params.surname)} />
          <button type="submit" className="btn btn-primary min-h-11">Hide this character</button>
        </form>

        <p className="text-sm text-fg-2">
          To undo a hide, email <a className={link} href="mailto:hello@everloot.app">hello@everloot.app</a>. This form covers the
          armory only; a character the Everloot addon saw has its own <Link href="/players/opt-out" className={link}>hide form</Link>.
        </p>
        <p className="text-sm text-muted">
          <Link href={ARMORY_PATH} className={link}>Back to the armory</Link> · <Link href="/privacy#armory" className={link}>Privacy policy</Link>
        </p>
      </article>
    </Container>
  );
}
