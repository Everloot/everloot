import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { Container, PageHeader, SectionHeading } from "@/components/ui";
import { CURRENT_BUILD } from "@/data/game-data/raid";
import { CLASSES } from "@/design/tokens";
import { READING, ROLE_DOES, chooserReviewed, listed, optionWeights } from "@/lib/class-chooser";
import { ROLES, classLabel, type ClassSlug } from "@/lib/class-context";
import { guidesDir } from "@/lib/guides";
import { pageMetadata } from "@/lib/seo";
import { CHOOSER_FILES, parseClassChooser, type ClassChooserData } from "../../../../../kb/src/guides/class-chooser";
import ClassChooser from "./ClassChooser";

// Built once per deploy, like the class hubs: the chooser's files are read from kb/guides while the site builds, and
// `dynamic = "error"` fails the build if the page starts reading the request. The answers live in the link's fragment,
// which the chooser reads in the browser: no request carries them, so the site never receives them.
export const dynamic = "error";

const TITLE = "WoW Forever Class Chooser";
const PATH = "/classes/choose";
/** 120 to 160 characters (chooser.test.tsx). */
const description = "Answer a few questions about how you like to play WoW: Forever and see which classes fit your answers, with the reason and weight behind each.";
const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

/** The classes as the limits name several of them. */
const PLURAL: Record<ClassSlug, string> = {
  warrior: "Warriors", paladin: "Paladins", hunter: "Hunters", rogue: "Rogues", priest: "Priests",
  shaman: "Shaman", mage: "Mages", warlock: "Warlocks", druid: "Druids",
};

/** The chooser's two files as the site reads them; null when one is missing or breaks a rule, as the guide check refuses it. */
function loadChooser(): ClassChooserData | null {
  try {
    const read = (name: string) => readFileSync(join(guidesDir(), name), "utf8");
    return parseClassChooser(read(CHOOSER_FILES.roles), read(CHOOSER_FILES.chooser));
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const data = loadChooser();
  // Out of search until both files are reviewed. A result lives in the link's fragment, which is never a page of its own.
  return { ...pageMetadata({ title: TITLE, description, path: PATH }), robots: { index: data !== null && chooserReviewed(data), follow: true } };
}

/** A file's version and its review, in one sentence. */
function reviewLine(name: string, f: { version: number; status: string; reviewer: string; reviewedOn: string | null }): string {
  return f.status === "reviewed" ? `${name} version ${f.version}, reviewed by ${f.reviewer} on ${f.reviewedOn}.` : `${name} version ${f.version}: a draft, not reviewed.`;
}

/**
 * Find a class by answering what you like about playing: the classes the answers fit, with the reasons and the weight
 * behind each, and links to the class hubs. The weights are Everloot's editorial choices, kept apart from the facts
 * they lean on, and every one of them is on the page. Until both files are reviewed the page says so first, stays out
 * of search and is linked from nowhere on the site.
 */
export default function ChooserPage() {
  const data = loadChooser();
  const reviewed = data !== null && chooserReviewed(data);
  return (
    <Container>
      <PageHeader
        trail={[{ name: "Home", path: "/" }, { name: "Classes", path: "/classes" }, { name: "Class chooser", path: PATH }]}
        title="Find a class"
        lede="Say what you like about playing, and the chooser names the classes that fit your answers, with the reasons and a link to each class."
      />
      {!reviewed && (
        <div role="note" className="mb-8 max-w-[75ch] rounded-control border border-line bg-panel p-4 text-sm">
          <p className="font-semibold text-warning">Draft for review: not reviewed yet</p>
          <p className="mt-1 text-fg-2">
            The questions, weights and facts on this page are Everloot&apos;s draft. No one has reviewed them yet, so the page
            stays out of search and no other page on the site links to it.
          </p>
        </div>
      )}
      {!data ? (
        <p className="text-sm text-muted">The class chooser is not available: its files do not pass their check.</p>
      ) : (
        <>
          <p className="mb-8 text-meta text-muted">{`${reviewLine("Weights", data.chooser)} ${reviewLine("Facts", data.roles)}`}</p>
          <ClassChooser data={data} />
          <Weights data={data} />
          <Limits data={data} />
        </>
      )}
    </Container>
  );
}

/** Every question, every answer and the weight it gives each class, with why. */
function Weights({ data }: { data: ClassChooserData }) {
  const { source } = data.roles;
  return (
    <section aria-labelledby="weights" className="mt-12 max-w-[75ch] space-y-6 text-sm text-fg-2">
      <SectionHeading id="weights">How each answer counts</SectionHeading>
      <p>
        Each answer adds a weight of 1, 2 or 3 to the classes it names: how far it leans toward a class, not a measure of
        one. A class&apos;s weight is the sum over your answers. The roles come from the source,{" "}
        <a href={source.url} rel="noopener" className={LINK}>{source.title}</a>, Blizzard&apos;s race and class article,
        checked {source.checkedOn}. The group effects come from the raid builder&apos;s table, read from the game files of
        build {CURRENT_BUILD}.
      </p>
      <div>
        <h3 className="font-semibold text-fg">Is there a race you want to play?</h3>
        <p className="mt-1">A race keeps the classes Blizzard&apos;s race tables let it be, and adds no weight.</p>
      </div>
      {data.chooser.questions.map((q) => (
        <div key={q.id}>
          <h3 className="font-semibold text-fg">{q.text}</h3>
          <ul className="mt-2 space-y-3">
            {q.options.map((o) => {
              const weighed = optionWeights(o, data);
              const facts = weighed.filter((w) => !w.reading);
              const readings = weighed.filter((w) => w.reading);
              return (
                <li key={o.id} data-option={`${q.id}.${o.id}`}>
                  <span className="font-semibold text-fg">{o.text}</span>{" "}
                  {o.role && `+${o.weight} for each class the source says ${ROLE_DOES[o.role].one}.`}
                  {o.role && !facts.length && ` No class: the source does not say which classes ${ROLE_DOES[o.role].many}.`}
                  {facts.length > 0 && (
                    <ul className="mt-1 space-y-1 pl-4">
                      {facts.map((w) => <li key={w.classSlug}>{o.role ? `${classLabel(w.classSlug)}: ${w.why}` : `${classLabel(w.classSlug)}: +${w.weight}. ${w.why}`}</li>)}
                    </ul>
                  )}
                  {readings.length > 0 && (
                    <>
                      <p className="mt-1">{`And by ${READING}:`}</p>
                      <ul className="mt-1 space-y-1 pl-4">
                        {readings.map((w) => <li key={w.classSlug}>{`${classLabel(w.classSlug)}: +${w.weight}. ${w.why}`}</li>)}
                      </ul>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** What the chooser leans on and what it cannot say, worked out from its files so it stays true when they change. */
function Limits({ data }: { data: ClassChooserData }) {
  const { classes } = data.roles;
  const byName = (a: ClassSlug, b: ClassSlug) => classLabel(a).localeCompare(classLabel(b));
  const unsourced = ROLES.filter((role) => !CLASSES.some((c) => classes[c].roles.some((r) => r.role === role)));
  const roleless = CLASSES.filter((c) => !classes[c].roles.length).sort(byName);
  // The role answers that weigh classes by Everloot's reading, each with the classes it reads.
  const reads = data.chooser.questions.flatMap((q) => q.options).filter((o) => o.role && o.readings?.length)
    .map((o) => ({ answer: o.text, classes: o.readings!.map((r) => r.class).sort(byName) }));
  const unread = roleless.filter((c) => !reads.some((r) => r.classes.includes(c)));
  return (
    <section aria-labelledby="limits" className="mt-12 max-w-[75ch] text-sm text-fg-2">
      <SectionHeading id="limits">What the chooser does not know</SectionHeading>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          The weights are Everloot&apos;s editorial choices, not measurements: an answer leans toward a class, and nothing
          here says a class is stronger than another or plays better.
        </li>
        <li>
          A role counts only where the source gives it.
          {unsourced.map((role) => ` The source does not say which classes ${ROLE_DOES[role].many}.`)}
          {roleless.length > 0 && ` It describes ${listed(roleless.map((c) => PLURAL[c]))} without naming a role.`}
          {reads.map((r) => ` "${r.answer}" weighs ${listed(r.classes.map((c) => PLURAL[c]))} by Everloot's reading of their descriptions, marked as such.`)}
          {unread.length > 0 && ` No role answer weighs ${listed(unread.map((c) => PLURAL[c]), "or")}.`}
          {" "}A class without a role here may still fill one; the source just does not say so.
        </li>
        <li>
          The group answers lean on the raid builder&apos;s table, read from the game files of build {CURRENT_BUILD} and
          unconfirmed until seen in play. It says what a class can bring, not what anyone will cast, and a later build can
          change it.
        </li>
        <li>Talents, gear, patches and how you play change what a class does. The chooser simulates none of it.</li>
        <li>Classes with the same weight are shown together, in alphabetical order. The chooser does not break a tie.</li>
        <li>
          Your answers stay in this page&apos;s address, after the # sign. Browsers do not send that part to a server, and
          the chooser sends your answers nowhere.
        </li>
      </ul>
    </section>
  );
}
