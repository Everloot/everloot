import type { Metadata } from "next";
import RaidView, { TITLE, description } from "@/components/RaidView";
import { getTool } from "@/data/tools";
import { pageMetadata } from "@/lib/seo";

const tool = getTool("raid")!;

export const metadata: Metadata = {
  ...pageMetadata({ title: TITLE, description, path: "/tools/raid", image: "/tools/raid/opengraph-image" }),
  keywords: tool.keywords,
};

export default async function RaidPage() {
  // Called, not rendered: the page stays one awaitable tree for the tests that render it. The page is built once,
  // so a class context from a class hub is read in the browser, under the title, by the planner's chip.
  return RaidView({ classContext: true });
}
