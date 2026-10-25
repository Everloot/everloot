import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader, SectionHeading } from "@/components/ui";
import { TOOL_LINES, toolGroups } from "@/data/tools";
import { guildsOn } from "@/lib/guild-switch";
import { trailFor } from "@/lib/breadcrumbs";
import { pageMetadata } from "@/lib/seo";

const description = "Everloot's tools for WoW: Forever: plan a build or a raid, look up prices and rankings, and track your own collections and gold.";

export const metadata: Metadata = pageMetadata({ title: "WoW Forever Tools", description, path: "/tools" });

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";

/** The index of the Tools menu: the same groups and names as the header, one line each. */
export default function ToolsPage() {
  return (
    <Container width="reading">
      <PageHeader title="Tools" lede={description} trail={trailFor("/tools")!} />
      <div className="space-y-12">
        {toolGroups(guildsOn()).map((group) => {
          const id = `tools-${group.title.toLowerCase().replace(/\W+/g, "-")}`;
          return (
            <section key={group.title} aria-labelledby={id}>
              <SectionHeading id={id}>{group.title}</SectionHeading>
              <ul className="divide-y divide-line border-y border-line">
                {group.links.map((l) => (
                  <li key={l.href} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
                    <Link href={l.href} className={link}>{l.label}</Link>
                    <span className="text-sm text-muted">{TOOL_LINES[l.href]}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Container>
  );
}
