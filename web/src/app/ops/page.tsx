import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Container, PageHeader } from "@/components/ui";
import Dashboard from "@/components/ops/Dashboard";
import { authorizeOps } from "@/lib/ops/access";
import { readOpsSummary } from "@/lib/ops/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const metadata: Metadata = { title: "Operations", robots: { index: false, follow: false, nocache: true } };

export default async function OperationsPage() {
  const requestHeaders = await headers();
  const principal = await authorizeOps(new Request("https://everloot.com/ops", { headers: new Headers(requestHeaders) }), "human");
  if (!principal || principal.kind !== "human") notFound();
  const snapshot = await readOpsSummary();
  if (!snapshot) return <Container><PageHeader title="Operations" lede="Private Everloot operations" /><p role="status" className="text-cell text-muted">Operations snapshot unavailable. A collector must publish a private snapshot before metrics can be shown.</p></Container>;
  return <Dashboard snapshot={snapshot} />;
}
