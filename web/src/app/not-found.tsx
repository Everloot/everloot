import type { Metadata } from "next";
import NotFoundBody from "./not-found-parts";

/**
 * The page already answers 404; the title names it in the tab and history. Next adds `<meta name="robots"
 * content="noindex">` to every answer over 400 on its own, so a robots entry here printed a second, identical tag
 * on every 404 (#815); null keeps the layout's index,follow from reaching the page and leaves the one Next writes.
 */
export const metadata: Metadata = { title: "Page not found", robots: null };

export default function NotFound() {
  return <NotFoundBody />;
}
