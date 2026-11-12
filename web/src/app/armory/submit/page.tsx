import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import { Container, PageHeader } from "@/components/ui";
import { ARMORY_HIDE_PATH, ARMORY_PATH, ARMORY_SUBMIT_PATH, armoryOn } from "@/lib/armory";
import { armoryStore } from "@/lib/armory-store";
import { ArmoryCredit, armoryMetadata, CharacterFields, first, FormUnreachable, link, newest, NOT_FOUND_METADATA } from "../parts";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  if (!armoryOn()) return NOT_FOUND_METADATA;
  return armoryMetadata({ title: "Add a character to the armory", description: "Ask Everloot to read a WoW: Forever character from Blizzard's API.", path: ARMORY_SUBMIT_PATH });
}

type Search = { region?: string | string[]; name?: string | string[]; surname?: string | string[]; armoryUrl?: string | string[]; done?: string | string[]; error?: string | string[] };

const ERROR: Record<string, string> = {
  limit: "Too many requests from this connection. Try again in an hour.",
  storage: "We could not save that. Try again in a moment.",
  invalid: "Check the name and the surname: letters only, 2 to 12 for the name and 2 to 24 for the surname.",
};

export default async function ArmorySubmitPage(props: { searchParams: Promise<Search> }) {
  if (!armoryOn()) notFound();
  const params = await props.searchParams;
  const done = first(params.done);
  const error = first(params.error);
  // A store out of reach still draws the form; the read time is then unrecorded.
  const counts = await armoryStore().counts().catch(() => null);

  return (
    <Container width="reading">
      <article className="max-w-xl space-y-6">
        <PageHeader
          trail={[...trailFor("/armory")!, { name: "Add a character", path: ARMORY_SUBMIT_PATH }]}
          title="Add a character"
          lede="Enter a character's region, name and surname, and Everloot asks Blizzard's API for it on its next run, usually within a few hours. If Blizzard does not know the character, nothing is added."
          meta={<ArmoryCredit at={counts ? newest(counts.map((c) => c.newest)) : null} />}
        />

        {done === "1" && <p role="status" className="rounded-card border border-line bg-panel p-4 text-fg">Thanks. The character is queued; its page appears once it has been read.</p>}
        {done === "0" && <p role="status" className="rounded-card border border-line bg-panel p-4 text-fg">Nothing to add: that character is queued already, was read in the last 20 days, or cannot be added.</p>}
        {counts === null && <FormUnreachable />}
        {error && <p role="alert" className="rounded-card border border-line bg-panel p-4 text-fg">{ERROR[error] ?? ERROR.invalid}</p>}

        <form action="/armory/submit/send" method="post" className="space-y-4">
          <CharacterFields region={first(params.region)} name={first(params.name)} surname={first(params.surname)} />
          <button type="submit" className="btn btn-primary min-h-11">Add this character</button>
        </form>

        <form action="/armory/submit/send" method="post" className="space-y-3">
          <label htmlFor="armory-url" className="block text-sm text-fg">Or paste a Blizzard armory link</label>
          <input id="armory-url" name="armoryUrl" type="url" required maxLength={500} defaultValue={first(params.armoryUrl)} placeholder="https://worldofwarcraft.blizzard.com/forever/…" className="w-full min-h-11 rounded-control border border-edge bg-canvas px-3 text-fg" />
          <button type="submit" className="btn btn-secondary min-h-11">Add from link</button>
        </form>

        <p className="text-sm text-muted">
          <Link href={ARMORY_PATH} className={link}>Back to the armory</Link> · <Link href={ARMORY_HIDE_PATH} className={link}>Hide a character</Link>
        </p>
      </article>
    </Container>
  );
}
