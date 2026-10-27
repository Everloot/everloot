import type { Metadata } from "next";
import { Container, PageHeader, SectionHeading } from "@/components/ui";
import { CURRENT_BUILD } from "@/data/game-data/raid";
import type { ClassSlug } from "@/lib/class-context";
import { reviewedRoles } from "@/lib/class-group";
import { classGuides } from "@/lib/class-hub";
import { pageMetadata } from "@/lib/seo";
import { TALENT_CLASSES } from "@/lib/talents/catalogs";
import type { GuideRole } from "../../../../../kb/src/guides/guide";
import GroupPlanner from "./GroupPlanner";

// Built once per deploy, like the class hubs: the roles come from the reviewed guides in kb/guides, read while the
// site builds, and `dynamic = "error"` fails the build if the page starts reading the request. The group is in the
// link's fragment, which the planner reads in the browser.
export const dynamic = "error";

const TITLE = "WoW Forever Group Planner";
/** 120 to 160 characters (group.test.tsx). */
const description = "Choose the classes for a WoW: Forever group of 5, 10, 20 or 40 players and see which raid buffs and debuffs they bring and which nobody brings.";

export const metadata: Metadata = {
  ...pageMetadata({ title: TITLE, description, path: "/classes/group" }),
  // As built, the page is an empty planner, so it stays out of search like a class hub with no reviewed guide.
  robots: { index: false, follow: true },
};

/**
 * Plan a group by class: what its classes bring, what nobody in it brings, and the roles reviewed guides are written
 * for. The coverage is the raid builder's, and the group opens there with the same classes. No class is compared.
 */
export default function GroupPage() {
  const roles = Object.fromEntries(TALENT_CLASSES.map((slug) => [slug, reviewedRoles(classGuides(slug))])) as Record<ClassSlug, GuideRole[]>;
  return (
    <Container>
      <PageHeader
        trail={[{ name: "Home", path: "/" }, { name: "Classes", path: "/classes" }, { name: "Group", path: "/classes/group" }]}
        title="Plan a group"
        lede="Choose the classes for a group of 5, 10, 20 or 40 players to see which buffs and debuffs they bring, and which nobody brings."
      />
      <GroupPlanner roles={roles} />

      <section aria-labelledby="about" className="mt-12 max-w-[75ch] space-y-3 text-sm text-fg-2">
        <SectionHeading id="about">How the planner works</SectionHeading>
        <p>
          What a class brings is the raid builder&apos;s coverage, read from the game files of build {CURRENT_BUILD} and
          unconfirmed until it is seen in play. It is what the classes can bring, not what anyone will cast: a Shaman
          counts as able to bring every totem, though one Shaman drops one totem per element. Effects in one family, such
          as Mark of the Wild and Gift of the Wild, count once.
        </p>
        <p>
          A party effect reaches only the party its caster is in. Parties fill five places at a time, in the order the
          classes are added; to move players between them, open the group in the raid builder.
        </p>
        <p>
          The planner does not compare classes: it lists what each one brings and what nobody in the group does. A role
          is shown only where a reviewed guide is written for it.
        </p>
        <p>The group&apos;s link holds its size and its classes, nothing else: no names, characters or talent trees.</p>
      </section>
    </Container>
  );
}
