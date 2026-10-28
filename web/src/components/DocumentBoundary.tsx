"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { crossesDocumentBoundary, reloadDocument } from "@/lib/document-boundary";

/**
 * Wraps the root layout's page. A client-side move between a public page and a protected one (chat, account,
 * settings) keeps the document, and with it the first page's Content-Security-Policy, so the page is not
 * mounted there: the boundary renders nothing and reloads, and the new document comes with the right policy.
 * The server and the first client render always agree, because a document's own page never crosses.
 */
export default function DocumentBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const crossed = pathname !== null && crossesDocumentBoundary(pathname);
  useEffect(() => { if (crossed) reloadDocument(); }, [crossed]);
  return crossed ? null : children;
}
