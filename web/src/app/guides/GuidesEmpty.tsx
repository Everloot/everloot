import Link from "next/link";
import { classLabel, type ClassSlug } from "@/lib/class-context";
import { REPO_URL } from "@/lib/source";

// What the guide pages say while no guide is reviewed: what a reviewed guide is, how one is offered and where to
// start. The same words on /guides, /classes and each class hub, so a reader who met them once knows what is asked.
// Each sentence comes from the repository: kb/guides/README.md and docs/GUIDES.md say what a guide is and that it is
// reviewed before it is published; CONTRIBUTING.md says to read docs/GUIDES.md and send the Guide submission form
// with sources and a link to a draft. Not /guides/write: that page is signed-in only, off unless its flag is set, and
// its submissions wait for a review that is not built yet.

export const GUIDE_CONTRACT_URL = `${REPO_URL}/blob/main/docs/GUIDES.md`;
export const GUIDE_SUBMISSION_URL = `${REPO_URL}/issues/new?template=guide-submission.yml`;

const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

export default function GuidesEmpty({ classSlug, classes = false }: {
  /** The hub's class: the lead names it and the calculator link opens on its trees. */
  classSlug?: ClassSlug;
  /** Link the class pages. Off on /classes and the hubs, which are those pages. */
  classes?: boolean;
}) {
  const name = classSlug ? classLabel(classSlug) : null;
  return (
    <div data-guides-empty className="max-w-3xl space-y-2 text-sm">
      <p className="text-fg">{name ? `No ${name} guide is reviewed yet.` : "No guide is reviewed yet."}</p>
      <p className="text-fg-2">
        A guide is Everloot&apos;s own advice on one talent plan for one class: who it is for, why it fits an activity, how to
        play it and what we do not know yet. It is reviewed before it is published.
      </p>
      <p className="text-fg-2">
        To offer one, read <a href={GUIDE_CONTRACT_URL} rel="noopener" className={LINK}>the guide contract</a>, plan the build in
        the <Link href={classSlug ? `/tools/talents/${classSlug}` : "/tools/talents"} className={LINK}>{name ? `${name} talent calculator` : "Talent calculator"}</Link> and
        send the <a href={GUIDE_SUBMISSION_URL} rel="noopener" className={LINK}>Guide submission form</a> with your sources and a link to
        your draft.
        {classes && <> Each <Link href="/classes" className={LINK}>class page</Link> lists its guides once one is reviewed.</>}
      </p>
    </div>
  );
}
