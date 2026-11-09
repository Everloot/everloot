import type { Metadata } from "next";
import NotFoundBody from "../not-found-parts";

/**
 * The 404 a database page throws for an id nothing knows (`unknown.ts`). Before this file the subtree had no
 * not-found of its own and the answer came back with the title and no body (#975). Same metadata rule as the site
 * 404: Next prints the noindex tag on every answer over 400 itself (#815).
 */
export const metadata: Metadata = { title: "Page not found", robots: null };

export default function DatabaseNotFound() {
  return <NotFoundBody database />;
}
