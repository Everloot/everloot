"use client";

import { usePathname } from "next/navigation";
import { crossesDocumentBoundary, isProtectedPath } from "@/lib/document-boundary";

/**
 * The ads and analytics (AdSense, the consent banner and what it loads), on public pages only. The pages that
 * hold chat keys or the account load none of them, and their policy would block them anyway (next.config.js).
 * An unknown path counts as protected.
 */
export default function OptionalScripts({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === null || isProtectedPath(pathname) || crossesDocumentBoundary(pathname)) return null;
  return children;
}
