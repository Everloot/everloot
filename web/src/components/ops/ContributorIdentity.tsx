"use client";

import { useEffect, useState } from "react";

type Detail = {
  identity: null | { name: string; realm: string; class: string; level: number; path: string; provenance: "contributor-opt-in"; attributedAt: string };
  attribution: "anonymous" | "opted-in" | "unavailable";
};

/** Named associations are read separately under current server-side disclosure checks. */
export default function ContributorIdentity({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/ops/contributors/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("Unavailable"); return await response.json() as Detail; })
      .then(value => { if (!controller.signal.aborted) setDetail(value); })
      .catch(() => { if (!controller.signal.aborted) setDetail({ identity: null, attribution: "unavailable" }); });
    return () => controller.abort();
  }, [id]);
  if (!detail) return <p role="status" className="mt-3 text-cell text-muted">Checking current attribution…</p>;
  const identity = detail.attribution === "opted-in" && detail.identity?.provenance === "contributor-opt-in" ? detail.identity : null;
  if (!identity) return <p className="mt-3 text-cell text-muted">Submitting identity: {detail.attribution === "unavailable" ? "unavailable" : "unknown (anonymous contribution)"}. Observed characters are never used as contributor attribution.</p>;
  return <div className="mt-3 space-y-1 text-cell text-fg-2">
    <h4 className="font-semibold text-fg">Optional request attribution</h4>
    <p>{identity.path.startsWith("/") && !identity.path.startsWith("//") ? <a href={identity.path} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{identity.name}</a> : identity.name} · {identity.class} · level {identity.level} · {identity.realm}</p>
    <p className="text-meta text-muted">Contributor opt-in · attributed {identity.attributedAt}. This request context does not establish authorship of every record or historical upload.</p>
  </div>;
}
