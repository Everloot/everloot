"use client";

import { usePathname } from "next/navigation";
import { crossesDocumentBoundary, isAdFreePath } from "@/lib/document-boundary";

/**
 * The ads and analytics (AdSense, the consent banner and what it loads), on public pages only. The pages that
 * hold chat keys or the account load none of them, and their policy would block them anyway (next.config.js).
 * Nor do the ad-free public pages (data/ad-free-paths.json): the Blizzard auction page, which Blizzard's terms
 * keep free of ads. An unknown path counts as protected.
 */
export default function OptionalScripts({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === null || isAdFreePath(pathname) || crossesDocumentBoundary(pathname)) return null;
  return children;
}
