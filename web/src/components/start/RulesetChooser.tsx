"use client";

import { useId, useState, type FormEvent } from "react";
import Card from "@/components/ui/Card";
import SectionHeading from "@/components/ui/SectionHeading";
import { suggestRuleset } from "@/lib/ruleset-chooser";

const QUESTIONS = [
  { name: "pvp", label: "Do you want world PvP in contested zones?", yes: "Yes, I want that danger", no: "No, I want to opt in to PvP" },
  { name: "roleplay", label: "Do you want to roleplay?", yes: "Yes, I want to stay in character", no: "No roleplay preference" },
  { name: "friends", label: "Are you joining friends?", yes: "Yes, we want to group together", no: "No, I am choosing for myself" },
] as const;

export default function RulesetChooser() {
  const id = useId();
  const [result, setResult] = useState<ReturnType<typeof suggestRuleset> | null>(null);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    if (!QUESTIONS.every((q) => ["yes", "no"].includes(String(data.get(q.name))))) return;
    setResult(suggestRuleset({ pvp: data.get("pvp") === "yes", roleplay: data.get("roleplay") === "yes", friends: data.get("friends") === "yes" }));
  }
  return (
    <Card>
      <SectionHeading as="h3" id={`${id}-title`} note="Three questions to suggest a ruleset for your preferences.">Find your ruleset</SectionHeading>
      <form aria-labelledby={`${id}-title`} onSubmit={submit} onChange={() => setResult(null)} className="space-y-5">
        {QUESTIONS.map((q) => (
          <fieldset key={q.name} className="space-y-2">
            <legend className="mb-2 font-medium text-fg">{q.label}</legend>
            {(["yes", "no"] as const).map((value) => (
              <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 text-fg-2">
                <input type="radio" name={q.name} value={value} required className="h-4 w-4 accent-accent" />
                {q[value]}
              </label>
            ))}
          </fieldset>
        ))}
        <button type="submit" className="btn">Suggest a ruleset</button>
        <div role="status" aria-atomic="true" className="space-y-2 text-fg-2">
          {result && <>
            <p className="font-semibold text-fg">Suggested: {result.name}</p>
            <p>{result.why}</p>
            {result.friends && <p>{result.friends}</p>}
            <p>Playing on another ruleset later means creating a new character.</p>
          </>}
        </div>
      </form>
      <p className="mt-4 text-sm text-muted">Hardcore is announced for sometime after launch. Availability and start date: Not confirmed yet. This chooser suggests the four launch rulesets; see the table and Blizzard source below.</p>
      <noscript>The questions need JavaScript. Use the ruleset table below to compare the choices.</noscript>
    </Card>
  );
}
