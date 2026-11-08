import type { Metadata } from "next";
import { Cards, LinkCard, P } from "@/components/docs/blocks";
import DocPage from "@/components/docs/DocPage";
import { DOCS_TABS } from "@/lib/docs/nav";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Cookbook",
  description: "Short, tested walkthroughs for common jobs with Everloot: tooltips on your site, questions to Claude, prices and drop rates in a script or spreadsheet.",
  path: "/docs/cookbook",
});

const RECIPES = DOCS_TABS.find((tab) => tab.id === "cookbook")?.groups.find((group) => group.title === "Recipes")?.pages ?? [];

export default function Cookbook() {
  return (
    <DocPage href="/docs/cookbook">
      <P>
        Each recipe does one job from start to finish: what you need, the steps with code you can paste, what you should
        see, and how to check it worked.
      </P>
      <Cards>
        {RECIPES.map((page) => (
          <LinkCard key={page.href} href={page.href} title={page.title} icon="terminal">{page.lede}</LinkCard>
        ))}
      </Cards>
    </DocPage>
  );
}
