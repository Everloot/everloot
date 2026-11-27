"use client";

import Link from "@/components/Link";
import type { ComponentProps } from "react";
import { navigationStarted } from "../NavPending";

/**
 * next/link for the controls that load a new server-rendered list (filters, sort headers, the pager, link tabs):
 * while its page loads, the navigation bar shows (NavPendingBar).
 */
export default function PendingLink(props: Omit<ComponentProps<typeof Link>, "href" | "onNavigate"> & { href: string }) {
  return <Link {...props} onNavigate={() => navigationStarted(props.href)} />;
}
