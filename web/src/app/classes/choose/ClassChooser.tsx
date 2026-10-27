"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { CLASS_TEXT } from "@/components/talents/TalentTreeView";
import { Card, SectionHeading } from "@/components/ui";
import {
  FACTIONS, RACE, ROLE_DOES, answersHash, article, chooseClasses, listed, parseAnswers, raceChoices, raceLabel,
  type Answers, type ChooserResult, type ClassFit, type RaceChoice,
} from "@/lib/class-chooser";
import { classHubHref, classLabel } from "@/lib/class-context";
import type { ClassChooserData } from "../../../../../kb/src/guides/class-chooser";

const LINK = "underline decoration-edge underline-offset-4 hover:decoration-fg";
const control = "min-h-11 w-full rounded-control border border-edge bg-canvas px-3 text-base text-fg";
/** Puts the answers in the address, which is then the link to them. Fires no hashchange. */
const showInAddress = (hash: string) => history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
const capital = (words: string) => words[0].toUpperCase() + words.slice(1);
/** "a Tauren", "an Orc", "a Horde Skyborne". */
const aRace = (race: RaceChoice, races: RaceChoice[]) => `${article(raceLabel(race, races))} ${raceLabel(race, races)}`;
/** "a Druid, Hunter, Shaman or Warrior". */
const aClassList = (fits: { classSlug: ClassFit["classSlug"] }[]) => {
  const names = fits.map((f) => classLabel(f.classSlug));
  return `${article(names[0] ?? "")} ${listed(names, "or")}`;
};

/** The result's heading: the class or classes the answers fit most, or that none stands out. */
function headline(result: ChooserResult | null, answers: Answers, races: RaceChoice[]): string {
  if (!result) return "Classes that fit your answers";
  const names = result.top.map((f) => classLabel(f.classSlug));
  if (names.length === 1) return `${names[0]} fits your answers most`;
  if (names.length > 1) return `${listed(names)} fit your answers equally`;
  if (result.race && Object.keys(answers).every((key) => key === RACE)) return `What ${aRace(result.race, races)} can be`;
  return "No class stands out on your answers";
}

/** One class the answers fit: its hub, its weight and each answer that gave it some, with why. */
function Fit({ fit }: { fit: ClassFit }) {
  return (
    <>
      <Link href={classHubHref({ classSlug: fit.classSlug })} className={`font-semibold ${LINK} ${CLASS_TEXT[fit.classSlug]}`}>{classLabel(fit.classSlug)}</Link>
      <span className="ml-2 text-meta text-muted">{`Weight from your answers: ${fit.score}`}</span>
      <ul className="mt-1 space-y-1 text-sm text-fg-2">
        {fit.reasons.map((r) => <li key={r.question}>{`${r.answer}: +${r.weight}. ${r.why}`}</li>)}
      </ul>
    </>
  );
}

/**
 * The chooser: the questions as a form, then the classes the answers fit. The answers live in the address's fragment, so
 * the address is the link to them; browsers never send a fragment to a server, and nothing here sends the answers
 * anywhere. As built, the buttons are disabled until the page runs in the browser, so a page without JavaScript sends no
 * answers either.
 */
export default function ClassChooser({ data }: { data: ClassChooserData }) {
  const races = raceChoices(data);
  const [answers, setAnswers] = useState<Answers>({});
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const result = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  // Where focus goes once the answers are shown: the result after Show, the first question after Start again.
  const refocus = useRef<"result" | "form" | null>(null);

  useEffect(() => {
    // Read once the page is in the browser, and again when a link is pasted into this tab's address bar. Each read writes
    // back the answers it opened, so nothing else the link carried stays in the address.
    const read = () => {
      const opened = parseAnswers(new URLSearchParams(location.hash.slice(1)), data);
      const shown = opened.ok ? opened.answers : {};
      showInAddress(answersHash(shown, data));
      setAnswers(shown);
      setError(opened.ok ? null : opened.error);
    };
    read();
    setReady(true);
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [data]);

  useLayoutEffect(() => {
    const target = refocus.current;
    refocus.current = null;
    if (target === "result") result.current?.focus();
    if (target === "form") form.current?.querySelector<HTMLElement>("select, input")?.focus();
  }, [answers]);

  const show = (next: Answers, focus: "result" | "form") => {
    showInAddress(answersHash(next, data));
    refocus.current = focus;
    setAnswers(next);
    setError(null);
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const given = [...new FormData(e.currentTarget)].filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "");
    show(Object.fromEntries(given), "result");
  };

  const fit = chooseClasses(answers, data);
  const weighedAside = fit?.excluded.filter((f) => f.score > 0) ?? [];

  return (
    <div className="space-y-10">
      <section aria-labelledby="answers">
        <SectionHeading id="answers">Your answers</SectionHeading>
        {error && <p role="alert" className="mb-4 text-sm text-fg">{`${error} The chooser shows no answers instead.`}</p>}
        {/* A new set of answers draws the form afresh, so its choices are always the address's. */}
        <form key={answersHash(answers, data)} ref={form} onSubmit={submit} className="max-w-[75ch] space-y-6">
          <label className="block max-w-sm space-y-1 text-sm">
            <span className="block font-semibold text-fg">Is there a race you want to play?</span>
            <select name={RACE} defaultValue={answers[RACE] ?? ""} className={control}>
              <option value="">No preference</option>
              {FACTIONS.map((faction) => (
                <optgroup key={faction} label={faction}>
                  {races.filter((r) => r.faction === faction).map((r) => <option key={r.key} value={r.key}>{r.race}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          {data.chooser.questions.map((q) => (
            <fieldset key={q.id}>
              <legend className="text-sm font-semibold text-fg">{q.text}</legend>
              <div className="mt-1 grid gap-x-6 sm:grid-cols-2">
                {[{ id: "", text: "No preference" }, ...q.options].map((o) => (
                  <label key={o.id || "none"} className="flex min-h-11 items-center gap-3 text-sm text-fg-2">
                    <input type="radio" name={q.id} value={o.id} defaultChecked={(answers[q.id] ?? "") === o.id} className="size-5 shrink-0" />
                    {o.text}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <noscript>
            <p className="text-sm text-muted">The chooser works out its answer in your browser, so it needs JavaScript. How each answer counts is below either way.</p>
          </noscript>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={!ready} className="btn btn-primary">Show the classes that fit</button>
            <button type="button" disabled={!ready} className="btn" onClick={() => show({}, "form")}>Start again</button>
          </div>
        </form>
      </section>

      <section aria-labelledby="result" className="max-w-[75ch]">
        <h2 id="result" ref={result} tabIndex={-1} className="mb-4 scroll-mt-24 text-xl font-semibold tracking-tight text-fg">{headline(fit, answers, races)}</h2>
        {!fit ? (
          <p className="text-sm text-muted">Answer at least one question, then choose Show the classes that fit.</p>
        ) : (
          <div className="space-y-4 text-sm text-fg-2">
            {fit.top.length > 1 && <p>They tie on your answers. Tied classes are listed in alphabetical order; the chooser does not break a tie.</p>}
            {fit.top.length > 0 && (
              <ul className="space-y-3">
                {fit.top.map((f) => <Card key={f.classSlug} as="li"><Fit fit={f} /></Card>)}
              </ul>
            )}
            {fit.top.length === 0 && fit.race && <p>{`${capital(aRace(fit.race, races))} can be ${aClassList(fit.race.classes.map((classSlug) => ({ classSlug })))} in Blizzard's tables.`}</p>}
            {fit.silent.map((s) => (
              <p key={s.question}>
                {s.reason === "none"
                  ? `"${s.answer}" gives weight to no class: the source does not say which classes ${ROLE_DOES[s.role].many}.`
                  : `"${s.answer}" gives weight to no class ${aRace(fit.race!, races)} can be.`}
              </p>
            ))}
            {fit.alternatives.length > 0 && (
              <div>
                <h3 className="font-semibold text-fg">Also fit some of your answers</h3>
                <ul className="mt-2 space-y-3">
                  {fit.alternatives.map((f) => <li key={f.classSlug}><Fit fit={f} /></li>)}
                </ul>
              </div>
            )}
            {fit.top.length > 0 && fit.unweighed.length > 0 && <p>{`Your answers give no weight to ${listed(fit.unweighed.map(classLabel))}.`}</p>}
            {fit.race && fit.excluded.length > 0 && (
              <p>
                {`${capital(aRace(fit.race, races))} cannot be ${aClassList(fit.excluded)} in Blizzard's tables, so they are set aside.`}
                {weighedAside.length > 0 && ` Your other answers weigh ${listed(weighedAside.map((f) => `${classLabel(f.classSlug)} ${f.score}`))}.`}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
