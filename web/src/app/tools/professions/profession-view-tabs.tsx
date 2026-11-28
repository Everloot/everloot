"use client";

import Link from "@/components/Link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { SELECT_CLASS } from "./controls";

/** Pane links keep live planner settings after the browser updates the URL without a server navigation. */
export default function ProfessionViewTabs({ path, reference, initialQuery, referenceParams, referenceAnchors, professions }: {
  path: string;
  reference: boolean;
  initialQuery: string;
  referenceParams: readonly string[];
  referenceAnchors: readonly string[];
  professions?: readonly { path: string; label: string }[];
}) {
  const router = useRouter();
  const current = useSearchParams()?.toString() ?? initialQuery;
  useEffect(() => {
    // A pre-split bookmark can point to a reference section with only a fragment, invisible to the server.
    if (reference || !referenceAnchors.includes(window.location.hash)) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("view")) return;
    url.searchParams.set("view", "reference");
    router.replace(`${url.pathname}${url.search}${url.hash}`);
  }, [reference, referenceAnchors, router]);

  const plan = new URLSearchParams(current);
  plan.delete("view");
  for (const key of referenceParams) plan.delete(key);
  const referenceQuery = new URLSearchParams(current);
  referenceQuery.set("view", "reference");
  return (
    <nav aria-label="Profession view" className="flex flex-wrap gap-2">
      {professions && <select aria-label="Profession" className={SELECT_CLASS} value={professions.find(option => option.path.split("?")[0] === path)?.path}
        onChange={event => router.push(event.target.value)}>
        {professions.map(option => <option key={option.path} value={option.path}>{option.label}</option>)}
      </select>}
      <Link href={plan.size ? `${path}?${plan}` : path} prefetch={false} aria-current={reference ? undefined : "page"} className={reference ? "btn" : "btn btn-primary"}>
        Plan
      </Link>
      <Link href={`${path}?${referenceQuery}`} prefetch={false} aria-current={reference ? "page" : undefined} className={reference ? "btn btn-primary" : "btn"}>
        Reference
      </Link>
    </nav>
  );
}
