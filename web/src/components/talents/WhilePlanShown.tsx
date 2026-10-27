"use client";

import { useEffect, useState, type ReactNode } from "react";
import { readPlanHash } from "@/lib/talents/import";

// Keeps a note about a link's plan on the page only while the calculator shows that plan. The calculator loads the
// share codes an address carries after #plan= and &plan2=, whether the page opens with them or a link is pasted in
// later, so while those are not the codes the note was made for, the note is gone. An address without a share code,
// such as an anchor on the page, leaves it as it is. This only reads the address; it never writes it.

export default function WhilePlanShown({ codes, children }: { codes: readonly (string | null)[]; children: ReactNode }) {
  const [first = null, second = null] = codes;
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const follow = () => {
      const plan = readPlanHash(window.location.hash);
      if (plan.first || plan.second) setShown(plan.first === first && plan.second === second);
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [first, second]);
  return shown ? <>{children}</> : null;
}
