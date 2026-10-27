import type { Metadata } from "next";
import Link from "next/link";
import { RememberedClass } from "@/components/classes/UseClassButton";
import { CLASS_TEXT } from "@/components/talents/TalentTreeView";
import { Container, DataTable, PageHeader, type Column } from "@/components/ui";
import { classLabel, type ClassSlug } from "@/lib/class-context";
import { classGuides, classesIndexable } from "@/lib/class-hub";
import { pageMetadata } from "@/lib/seo";
import { TALENT_CLASSES } from "@/lib/talents/catalogs";

// Built once per deploy, and the build fails before it renders for a request: the guide counts are read from
// kb/guides while the site builds, a folder no request can read.
export const dynamic = "error";

const TITLE = "WoW Forever Classes";

/** 120 to 160 characters either way, and honest about the guides (classes.test.tsx). */
const description = (guides: number) => guides
  ? `The nine WoW: Forever classes: ${guides} reviewed ${guides === 1 ? "guide" : "guides"} so far, each class's talent calculator, the races that can play it and the database pages.`
  : "The nine WoW: Forever classes, each with its talent calculator, the races that can play it and the database pages. No class guide is reviewed yet.";

type Row = { slug: ClassSlug; guides: number };
const rows = (): Row[] => TALENT_CLASSES.map((slug) => ({ slug, guides: classGuides(slug).length }));

export async function generateMetadata(): Promise<Metadata> {
  return {
    ...pageMetadata({ title: TITLE, description: description(rows().reduce((n, r) => n + r.guides, 0)), path: "/classes" }),
    // Indexed once a class has a reviewed guide; until then the index stays out of search like its hubs.
    robots: { index: classesIndexable(), follow: true },
  };
}

const columns: Column<Row>[] = [
  {
    key: "class", header: "Class", nowrap: true,
    cell: (r) => <Link href={`/classes/${r.slug}`} className={`font-medium underline-offset-4 hover:underline ${CLASS_TEXT[r.slug]}`}>{classLabel(r.slug)}</Link>,
  },
  { key: "guides", header: "Reviewed guides", numeric: true, cell: (r) => r.guides || <span className="text-muted">–</span> },
];

/** The nine classes, each linked to its hub with the reviewed guides it lists. No class is put first. */
export default function ClassesPage() {
  const list = rows();
  return (
    <Container>
      <PageHeader
        trail={[{ name: "Home", path: "/" }, { name: "Classes", path: "/classes" }]}
        title="Classes"
        lede="The nine WoW: Forever classes, each linked to its page: its talent calculator, the races that can play it and the database pages to plan with."
      />
      <RememberedClass />
      <DataTable caption="WoW: Forever classes" columns={columns} rows={list} rowKey={(r) => r.slug} />
      {list.every((r) => r.guides === 0) && <p className="mt-3 text-sm text-muted">No class guide is reviewed yet.</p>}
    </Container>
  );
}
