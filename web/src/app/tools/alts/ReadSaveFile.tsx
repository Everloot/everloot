"use client";

import { useEffect, useRef, useState } from "react";
import { Card, SectionHeading } from "@/components/ui";
import {
  ADDON_FILE_LIMIT, ADDON_FILE_TOO_LARGE, applyAltImport, changesAlt, defaultChoices, previewAltImport, readAddonFile, rowChoices, takeAs,
  type AltImportPreview, type DetailChange, type ImportRow, type RowChoice,
} from "@/lib/alt-import";
import { DETAIL_WORDS, altFailure, altKey, altLabel, copyNumbers, detailValue, detailsLine, listOf } from "@/lib/alt-workspace";
import { WORKSPACE_LIMITS, deviceStorage, readWorkspace, type LocalAlt, type Owner } from "@/lib/player-workspace";

// The player's Everloot.lua, read in this page (lib/alt-import.ts) and its characters added as alts after a preview.
// The file's text goes from the file to the reader and no further: it is not uploaded or stored, and is not kept once
// read. The preview holds each character's name, realm, class, faction and level, and nothing else from the file.

const FILE_PATH = "World of Warcraft/<game version>/WTF/Account/<account>/SavedVariables/Everloot.lua";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
/** "Oct 27, 2026, 10:00 AM": to the minute, so copies changed on one day read apart. */
const when = (at: string) => new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** The start of an alt's notes, to tell its copies apart: notes “Raid notes”, or no notes. */
function notesHint(notes: string): string {
  if (!notes) return "no notes";
  const line = Array.from(notes.split("\n")[0]);
  return `notes “${line.length > 40 ? `${line.slice(0, 40).join("").trimEnd()}…` : line.join("")}”`;
}

/** "level 24 → 31", or "faction Horde, not set here". */
const changeText = ({ detail, here, file }: DetailChange) =>
  here === null ? `${DETAIL_WORDS[detail]} ${detailValue(detail, file)}, not set here` : `${DETAIL_WORDS[detail]} ${detailValue(detail, here)} → ${detailValue(detail, file)}`;

/** What the preview says first: what the file holds, and what reading it would do. */
function summary(preview: AltImportPreview): string {
  const { rows } = preview;
  if (rows.length === 0) return "This file has no gold, money or link records of your own characters, so there is nothing to add from it.";
  const count = (status: ImportRow["status"]) => rows.filter((r) => r.status === status).length;
  if (count("same") === rows.length) return "Nothing to add: every character in this file is already here.";
  const parts = [
    count("new") > 0 ? `${count("new")} not here yet` : "",
    count("update") > 0 ? `${count("update")} with newer details` : "",
    count("ambiguous") > 0 ? `${count("ambiguous")} that may be an alt whose realm is not set` : "",
    count("twice") > 0 ? `${count("twice")} here as more than one alt` : "",
    count("same") > 0 ? `${count("same")} already here` : "",
  ].filter(Boolean);
  return `Found ${plural(rows.length, "of your characters", "of your characters")}: ${listOf(parts)}.`;
}

/** Why some of the file was not used. Nothing in it is guessed at. */
function unused(preview: AltImportPreview): string[] {
  const { skipped: { noRealm, unreadable }, others } = preview;
  return [
    noRealm > 0 ? `${plural(noRealm, "record")} of yours named a character but no realm, so ${noRealm === 1 ? "it was" : "they were"} not used.` : "",
    unreadable > 0 ? `${plural(unreadable, "record")} of yours had no name or time that could be read, so ${unreadable === 1 ? "it was" : "they were"} not used.` : "",
    others > 0 ? `The file's ${plural(others, "other record")} (sightings of other players, census rows and the rest) ${others === 1 ? "is" : "are"} not used here.` : "",
  ].filter(Boolean);
}

const keptText = (k: DetailChange) => `Kept as you set it: ${DETAIL_WORDS[k.detail]} ${detailValue(k.detail, k.here)} (the file says ${detailValue(k.detail, k.file)}).`;

/** The alt a choice names, if it names one. */
const chosen = (choice: RowChoice, alts: Map<string, LocalAlt>) => (choice.startsWith("alt:") ? alts.get(choice.slice("alt:".length)) : undefined);

/** What taking the character as the alt the player chose would do to it, said before anything is written. */
function takeLines(row: ImportRow, alt: LocalAlt): string[] {
  const { realm, newer, changes, kept } = takeAs(row.character, alt);
  return [
    realm ? `Its realm is set to ${realm}.` : "",
    !newer ? "Its details already come from an Everloot.lua at least as new as this one, so this file changes none of them."
      : changes.length > 0 ? `Newer details from the file: ${listOf(changes.map(changeText))}.`
        : "None of its details change; it is noted as matched to this file's records.",
    ...kept.map(keptText),
  ].filter(Boolean);
}

/** How a row reads: what the file says of the character, and what would happen to it as the player has chosen. */
function rowLines(row: ImportRow, alts: Map<string, LocalAlt>, choice: RowChoice): string[] {
  const unsure = row.altIds.flatMap((id) => alts.get(id) ?? []);
  const known = detailsLine(row.character);
  const taken = chosen(choice, alts);
  return [
    known || "The file names this character in gold or money records only, so its class, level and faction are not in it.",
    row.status === "new" ? "Not here yet."
      : row.status === "same" ? "Already here."
        : row.status === "update" ? `Newer details from the file: ${listOf(row.changes.map(changeText))}.`
          : row.status === "twice"
            ? `${altLabel(row.character)} is here as more than one alt. It is skipped unless you choose which of them gets the file's details.`
          : unsure.length === 1
            ? `This may be your alt ${unsure[0].name}, whose realm is not set. It is skipped unless you say which it is.`
            : `This may be one of your alts ${listOf(unsure.map((a) => a.name))}, whose realms are not set. It is skipped unless you say which it is.`,
    ...(taken ? takeLines(row, taken) : row.kept.map(keptText)),
  ];
}

function choiceText(choice: RowChoice, alts: Map<string, LocalAlt>, copies: Map<string, number>, status: ImportRow["status"]): string {
  if (choice === "skip") return "Skip it";
  if (choice === "add") return status === "ambiguous" ? "Add it as a new alt" : "Add it";
  if (choice === "update") return "Update it";
  const alt = alts.get(choice.slice("alt:".length));
  if (!alt) return "It is that alt";
  const label = `It is your alt ${altLabel(alt)}${alt.realm ? "" : " (realm not set)"}`;
  // Alts that read alike are told apart by the copy number Your alts shows them with, what each holds, when it last
  // changed and how its notes begin.
  const copy = copies.get(alt.id);
  return copy === undefined ? label : `${label}, copy ${copy}: ${detailsLine(alt) || "no details"}, updated ${when(alt.updatedAt)}, ${notesHint(alt.notes)}`;
}

export default function ReadSaveFile({ owner, onApplied }: {
  owner: Owner;
  /** What was added and updated, to say so. */
  onApplied: (done: string) => void;
}) {
  const [preview, setPreview] = useState<{ preview: AltImportPreview; alts: Map<string, LocalAlt>; copies: Map<string, number> } | null>(null);
  const [choices, setChoices] = useState<RowChoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  // Gone with its bucket: a file still being read when the account changes is not previewed for the next one.
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function choose(file: File) {
    setError(null);
    setPreview(null);
    // Refused by its size, before any of it is read.
    if (file.size > ADDON_FILE_LIMIT) { setError(ADDON_FILE_TOO_LARGE); return; }
    setReading(true);
    let found: ReturnType<typeof readAddonFile>;
    try {
      found = readAddonFile(await file.text());
    } catch {
      if (alive.current) { setReading(false); setError("That file could not be read. Nothing was changed."); }
      return;
    }
    if (!alive.current) return;
    setReading(false);
    if (!found.ok) { setError(found.message); return; }
    // Previewed against the bucket as stored now, not as this page last showed it.
    const now = readWorkspace(deviceStorage(), owner);
    if (!now.ok) { setError(altFailure(now.error).message); return; }
    const next = previewAltImport(found, now.workspace);
    setPreview({ preview: next, alts: new Map(now.workspace.alts.map((a) => [a.id, a])), copies: copyNumbers(now.workspace.alts) });
    setChoices(defaultChoices(next));
  }

  function apply() {
    if (!preview) return;
    const result = applyAltImport(deviceStorage(), owner, preview.preview, choices);
    if (!result.ok) {
      setError(result.message);
      // A choice the device has no room for can be changed; anything else needs the file read again.
      if (result.error !== "over-limit") setPreview(null);
      return;
    }
    setPreview(null);
    const { added, updated } = result;
    onApplied(added > 0 && updated > 0 ? `Added ${plural(added, "alt")} and updated ${updated.toLocaleString("en-US")} from your Everloot.lua.`
      : added > 0 ? `Added ${plural(added, "alt")} from your Everloot.lua.` : `Updated ${plural(updated, "alt")} from your Everloot.lua.`);
  }

  const adds = choices.filter((c) => c === "add").length;
  // An alt the player chose that the file would not change is no change to make.
  const acts = choices.filter((c, i) => {
    const alt = preview && chosen(c, preview.alts);
    return c !== "skip" && (!alt || changesAlt(takeAs(preview.preview.rows[i].character, alt)));
  }).length;
  const full = preview !== null && adds > preview.preview.room;
  const go = adds === acts ? "Add to this device" : adds === 0 ? "Update on this device" : "Add and update on this device";
  return (
    <Card as="section" aria-labelledby="alts-file">
      <SectionHeading id="alts-file" note="Adds your characters from the Everloot addon's file. The file is read in this browser and is not uploaded; only the details of the characters you add are kept.">
        Read your Everloot.lua
      </SectionHeading>
      {/* The addon writes no link records yet (character_link is in the record protocol only), so a file's details
          are names and realms for now. */}
      <p className="mb-3 text-sm text-fg-2">
        Today&apos;s addon files give each character&apos;s name and realm, from its gold records. Class, level and faction come once the addon records them.
      </p>
      {/* The input inside is hidden, so the label shows the site's focus ring while it has focus. */}
      <label className="btn cursor-pointer text-sm focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">Choose Everloot.lua
        <input aria-label="Choose Everloot.lua" type="file" accept=".lua" className="sr-only" disabled={reading}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void choose(f); e.target.value = ""; }} />
      </label>
      <p className="mt-3 text-sm text-muted">
        Log out of the game first, then find it at <code className="font-mono text-fg-2 [overflow-wrap:anywhere]">{FILE_PATH}</code>.
        Only your own characters&apos; gold, money and link records are read; sightings of other players and census rows are not.
      </p>
      {reading && <p className="mt-3 text-sm text-muted" role="status">Reading your file…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      {preview && (
        <div role="group" aria-label="What reading the file would do" className="mt-4 space-y-3 rounded-control border border-line bg-canvas p-3">
          <p className="text-sm text-fg">{summary(preview.preview)}</p>
          {unused(preview.preview).map((line) => <p key={line} className="text-sm text-fg-2">{line}</p>)}
          {preview.preview.rows.length > 0 && (
            <ul className="divide-y divide-line">
              {preview.preview.rows.map((row, i) => {
                const offered = rowChoices(row);
                const [first, ...rest] = rowLines(row, preview.alts, choices[i]);
                return (
                  <li key={altKey(row.character.name, row.character.realm)} className="space-y-1 py-3">
                    {offered.length > 1 ? (
                      <label className="block max-w-sm space-y-1 text-sm">
                        <span className="block font-semibold text-fg">{altLabel(row.character)}</span>
                        <select value={choices[i]} onChange={(e) => setChoices(choices.map((c, j) => (j === i ? e.target.value as RowChoice : c)))}
                          className="min-h-11 w-full rounded-control border border-edge bg-canvas px-3 text-base text-fg">
                          {offered.map((c) => <option key={c} value={c}>{choiceText(c, preview.alts, preview.copies, row.status)}</option>)}
                        </select>
                      </label>
                    ) : <p className="text-sm font-semibold text-fg">{altLabel(row.character)}</p>}
                    <p className="text-sm text-fg-2">{first}</p>
                    {rest.map((line) => <p key={line} className="text-sm text-muted">{line}</p>)}
                  </li>
                );
              })}
            </ul>
          )}
          {full && (
            <p role="alert" className="text-sm text-danger">
              This device keeps {WORKSPACE_LIMITS.alts} alts and has room for {plural(preview.preview.room, "more", "more")}. Skip some characters to add the rest.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {acts > 0 && <button type="button" className="btn btn-primary text-sm" disabled={full} onClick={apply}>{go}</button>}
            <button type="button" className="btn text-sm" onClick={() => setPreview(null)}>{acts > 0 ? "Cancel" : "Close"}</button>
          </div>
        </div>
      )}
    </Card>
  );
}
