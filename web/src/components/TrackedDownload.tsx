"use client";

import type { ReactNode } from "react";
import { track } from "@/lib/analytics/track";
import type { EventMap } from "@/lib/analytics/events";

/** A plain download link that also reports an addon_download event (a no-op unless analytics is on). */
export default function TrackedDownload({ href, addon, to, download, className, children }: { href: string; addon: string; to: EventMap["addon_download"]["to"]; download?: boolean; className?: string; children: ReactNode }) {
  return <a className={className} href={href} download={download} onClick={() => track("addon_download", { addon, to })}>{children}</a>;
}
