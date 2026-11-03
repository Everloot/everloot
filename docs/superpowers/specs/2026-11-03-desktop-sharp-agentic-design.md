# Desktop: a sharper, agentic Everloot (design, 2026-11-03)

## Intent

People who open the Everloot desktop app should feel a focused tool that is working for them, the way a
coding agent's console feels: dense, crisp, always saying what it is doing. Today (0.1.16) it reads as a
website in a frame: warm olive canvas, cream text, 232 px rail, 32 px page titles, roomy padding, and pages
that go blank until the addon's save file has data. Carlos's words: "more sharper like T3 Code nightly",
"feel and see the agentic style", "with our branding right", and "fill up the missing gaps": with no data
you cannot see the character profile at all.

## Goals

1. Sharp: the surfaces, type and spacing of a developer tool. Reference measured from T3 Code nightly's
   bundled stylesheet: black canvas, near-black panels (`#111`), borders at 8 % white, 13 to 14 px type,
   8 px radius, muted text at neutral-400, one strong primary colour.
2. Agentic: every page says what the app is doing for that job now, what it last did, and what it waits on.
   The rail carries live state pills. The Overview reads as a running thread of the app's own steps.
3. No blank pages: an empty area says why it is empty and offers the one action that fills it. Characters
   with no data draws the full profile layout as a ghost so the player sees what is coming.
4. Everloot stays Everloot: the lime accent, the diamond mark, Geist. The app is called "Everloot".

## Non-goals and anti-goals

- No framework, no new runtime dependency in the renderer. The page is vanilla TypeScript with a CSP that
  allows no inline styles; that stays.
- No change to what the app sends anywhere, to jobs, to quotas, to settings semantics or to `productName`,
  `appId` and artifact names (renaming them breaks the update path).
- No native Windows dialogs; in-app `<dialog class="confirm">` only (existing rule).
- Anti-goal: a dark theme that is merely darker. If it still reads like the site in a frame, it failed.
- Anti-goal: fake activity. The thread shows real engine log lines and job states, never invented steps.

## Constraints

- Launch is 2026-11-04 23:00 UTC. Stage 1 must be safe to ship before it; stage 2 follows in launch week.
- `desktop/src/renderer/styles.css` is the one stylesheet; `app.ts` renders HTML strings. Light theme comes
  from `prefers-color-scheme`; both must still pass.
- Keyboard focus, `forced-colors`, `prefers-reduced-motion` and the screen-reader text already in place
  stay intact. Every text token keeps 4.5:1 on canvas and panel.
- CSP: `style-src 'self'`; adding bundled fonts needs `font-src 'self'` and the files under `dist/renderer`.
- Tests: `npm test` (vitest) and `npm run typecheck` in `desktop/`; CI `checks.yml` runs them. Commits carry
  DCO sign-off; PR titles are `feat(desktop): plain sentence`.

## Approaches considered

1. **Restyle plus honest empty states.** New tokens and density on the pages that exist, empty areas get a
   cause and an action. One PR. Trade-off: sharp, but the app still does not narrate itself.
2. **Approach 1 plus the agentic layer and the profile on the page.** Working strips on job pages, Overview
   as a thread, Characters ghost profile with no data and the profile on the page with data. Two or three
   PRs. Trade-off: touches renderer logic; more to test.
3. Rebuild the renderer in a component framework. Dropped: the no-inline-style CSP, the 1,800-line vanilla
   renderer and the launch date rule it out.

**Picked: 2, staged so that stage 1 is approach 1** (Carlos, 2026-11-03: "Let's go on loop overnight to
get all this in shape, revise, tested and push and merge").

## The design

### Tokens (stage 1)

Dark (default), in `rgb` triplets as today:

| token | now | new | note |
|---|---|---|---|
| `--canvas` | 14 15 13 | 9 9 9 | T3 uses pure black; 9 keeps the window edge visible on OLED |
| `--panel` | 21 23 26 | 17 17 17 | `#111` |
| `--raised` | 29 32 28 | 24 24 24 | hover and control fills |
| `--line` | 58 59 53 | 255 255 255 / 0.08 | hairline; expressed as `--line-a` alpha token |
| `--edge` | 110 107 96 | 255 255 255 / 0.16 | inputs and stronger rules |
| `--fg` | 244 239 221 | 237 237 237 | neutral-100, no cream |
| `--fg-2` | 201 195 176 | 180 180 180 | |
| `--muted` | 150 146 130 | 140 140 140 | neutral-400 range, passes 4.5:1 on canvas |
| `--accent` | 156 240 58 | 156 240 58 | unchanged: the brand |
| `--radius` | 8 | 6 | controls; panels 8, dialogs 10 |
| body size | 14 | 13 | 14 for prose paragraphs (`.lead`, chat messages) |
| `--rail` | 232 | 216 | |
| `--pad` | 32 | 24 | |

Light keeps its current values except surfaces move to zinc (canvas 250 250 250, panel 255, lines at
0 0 0 / 0.08), so both modes are neutral.

Type: Geist and Geist Mono bundled from the `geist` npm package (OFL) into `dist/renderer/fonts`, loaded
with `@font-face`, `font-src 'self'` added to the CSP. Today the stylesheet names Geist but ships no file, so
Windows renders Segoe UI. Headings: page title 20 px / 600 / -0.01em (was 32 px hero and 28 px titles),
section 14 px / 600, eyebrows 11 px / 600 / 0.08em uppercase.

### Shell (stage 1)

- A 40 px title bar across the main area: breadcrumb "Everloot / Page", the watch state as a pill on the
  right ("Watching 1 file" or "Not watching"), draggable. The rail's brand row shrinks to 36 px.
- Rail items 30 px tall, 13 px, icon 16 px. Job items carry a state pill at the right instead of a dot:
  `Working` (info colour, spinner ring), `OK`, `Failed` (danger), `Off` (muted), `Waiting`. The screen-reader
  text already says the state; the pill makes it visible.
- Footer: account row, Settings, bug, the one round update button (unchanged behaviour), version.
- Panels: 1 px hairline, 8 px radius, no shadow. Status strips keep the one-frame-many-cells pattern.
- Buttons 30 px, inputs 30 px, tables 32 px rows with 11 px uppercase headers.

### Empty states (stage 1)

One component, `.empty`: an icon, a one-line cause, a one-line next step, and at most one button or link.
The cause comes from the engine, never a generic "nothing yet":

| page | cause (examples) | action |
|---|---|---|
| Characters | "Not watching a game folder" / "No Everloot.lua under <folder> yet" / "Save file read, no named character rows yet" | Open Settings / "Log out once in the game" / none |
| Upload | same causes; "Upload is off" | Turn on / Upload now |
| Market | "No realm followed" / "No scan in your save file yet" | Follow a realm |
| Ask | "/ask is off" | Turn on in Ask |
| Log | "Nothing logged since start" | none |
| Changes | network error text | Retry |

### Agentic layer (stage 2)

- **Working strip** at the top of Upload, Market and Ask: left, the job's state pill and headline ("Uploading
  TESTACC", "Prices for 2 realms are 40 minutes old", "Waiting for the next logout"); middle, the last log
  line for that job with its time; right, the job's action button. Built from `engine.jobs[job]` and the
  log; no new IPC.
- **Overview as a thread**: the hero shrinks to a one-line status bar; below it the engine log renders as a
  thread of steps, newest at the bottom, grouped by job with the job's icon, times in the gutter, errors in
  danger colour, the running job's line with the spinner ring. "Jobs" becomes a compact four-cell strip
  above the thread. Latest changes move to a right column at wide widths, under the thread when narrow.
- **Characters**: with no named rows, render the profile layout as a ghost: river card, week card and
  roster frame drawn with `.ghost` (hairline, dashed, 50 % opacity, `aria-hidden`), the `.empty` block on
  top with the real cause. With rows, the selected character's profile (river, week, gear slots, progress)
  renders on the page in a two-column layout; the drawer stays for the roster's other characters.

### What is left to the builder

- Exact pixel values inside the ranges above, chosen in the browser check, light and dark.
- Which log lines belong to which job (the engine prefixes them today: "upload", "prices", "ask").
- Whether `font-src` and the font copy go in `build.mjs` or `package.json` files; either is fine.
- Test shape: existing vitest suites plus render tests for the new empty-state and strip builders.

## Verification

- `npm test`, `npm run typecheck` in `desktop/`; `npm run build`; run the app with
  `--remote-debugging-port` and take screenshots of Overview, Characters (no data), Upload, Chat and
  Settings in dark and light with `scripts/screenshot.mjs`; attach to the PR.
- Keyboard pass: tab through the rail, a strip, an empty state and a dialog.
- Each stage is one PR, `feat(desktop): …`, signed off, merged after CI; a `desktop-v0.1.17` release
  follows stage 1 per `desktop/README.md`.
