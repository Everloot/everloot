# Desktop sharp and agentic: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Everloot desktop app reads as a crisp, dense tool that narrates its own work, in Everloot's brand, with no blank page.

**Architecture:** The renderer stays vanilla TypeScript that builds HTML strings (`desktop/src/renderer/app.ts`) under a CSP with no inline styles. Pure, DOM-free builders go in a new `desktop/src/renderer/parts.ts` so they can be unit-tested with vitest; `app.ts` only wires them in. `styles.css` carries the new tokens and components. Two pull requests: stage 1 (tokens, fonts, shell, pills, empty states) ships before launch; stage 2 (working strips, Overview thread, character profile) follows.

**Tech Stack:** Electron 44, esbuild, vitest, TypeScript. Fonts from the `geist` npm package already installed under `web/node_modules` (SIL OFL 1.1).

**Spec:** `docs/superpowers/specs/2026-11-03-desktop-sharp-agentic-design.md`

## Global Constraints

- No new runtime dependency in the renderer; no framework; no inline `style=` attributes (CSP `style-src 'self'`).
- `productName`, `appId` and `Everloot-DesktopApp-*` artifact names unchanged. The app is called "Everloot" in copy.
- Light mode (`prefers-color-scheme: light`), `forced-colors`, `prefers-reduced-motion` and existing `sr-only` text keep working. Every text token keeps 4.5:1 on canvas and panel.
- Dark tokens from the spec: canvas `9 9 9`, panel `17 17 17`, raised `24 24 24`, fg `237 237 237`, fg-2 `180 180 180`, muted `140 140 140`, accent `156 240 58` unchanged, lines at `255 255 255 / 0.08`, edges at `255 255 255 / 0.16`. Light surfaces: canvas `250 250 250`, panel `255 255 255`, lines `0 0 0 / 0.08`.
- Sizes: body 13 px (prose 14 px), page title 20 px / 600 / -0.01em, section 14 px / 600, eyebrow 11 px / 600 / 0.08em uppercase, rail 216 px, pad 24 px, controls 30 px, table rows 32 px, radius 6 px controls / 8 px panels / 10 px dialogs.
- The thread shows real engine log lines and job states only. Empty states state the engine's real cause.
- Commits signed off (`git commit -s`); PR titles `feat(desktop): plain sentence`, no full stop, under 100 chars.
- Tests and checks that CI runs for desktop: `npm test && npm run typecheck && npm run build` in `desktop/`.

## Review Focus

1. A log line that names no job (for example the "Watching 1 account file(s)" line) must still appear in the thread, under the app itself, never dropped. Test in Task 7.
2. A paused engine: rail pills and strips must say "Paused", not "Waiting", for jobs that are on. Test in Task 3 and Task 8.
3. Light mode: the state pills and the empty-state text must pass 4.5:1 on white; checked by the token test in Task 2.
4. A 640 px wide window: the title bar's breadcrumb and watch pill must wrap, never overflow sideways (the page never scrolls sideways). Checked in the browser pass of Task 6.
5. A very long cause line (a game folder path of 120+ characters) in an empty state or strip must wrap inside its box. Test in Task 5.

---

## Stage 1: PR A `feat(desktop): a sharper shell with bundled Geist, live state pills and honest empty states`

### Task 1: Bundle Geist and allow it in the CSP

**Files:**
- Modify: `desktop/scripts/build.mjs` (after the `cpSync` of `styles.css`)
- Modify: `desktop/src/renderer/index.html:5` (CSP meta)
- Modify: `desktop/src/renderer/styles.css` (top: two `@font-face` rules)
- Modify: `THIRD_PARTY.md` (a line for Geist in the desktop section, if the file lists per-part fonts; otherwise one line under the existing Geist entry noting the desktop app also ships it)
- Test: `desktop/test/renderer-files.test.ts`

**Interfaces:**
- Produces: `dist/renderer/fonts/Geist-Variable.woff2` and `dist/renderer/fonts/GeistMono-Variable.woff2` after `npm run build`.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
const html = readFileSync(new URL("../src/renderer/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
test("the page may load its own fonts and nothing else", () => {
  expect(html).toMatch(/font-src 'self'/);
  expect(html).not.toMatch(/font-src [^;]*https?:/);
});
test("Geist and Geist Mono are declared from the bundled files", () => {
  expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*"Geist"[^}]*url\("fonts\/Geist-Variable\.woff2"\)/);
  expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*"Geist Mono"[^}]*url\("fonts\/GeistMono-Variable\.woff2"\)/);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- renderer-files` (in `desktop/`). Expected: FAIL, no `font-src` in the CSP.

- [ ] **Step 3: Add the CSP source, the `@font-face` rules and the copy step**

CSP becomes `default-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; script-src 'self'`. In `build.mjs`, copy the two files from `join(root, "..", "web", "node_modules", "geist", "dist", "fonts", "geist-sans", "Geist-Variable.woff2")` and `.../geist-mono/GeistMono-Variable.woff2` to `join(dist, "renderer", "fonts")`, creating the folder; fail the build with a clear message if a file is missing (the release workflow installs `web` first). `@font-face` uses `font-weight: 100 900; font-display: swap`.

- [ ] **Step 4: Run the test and the build**

Run: `npm test -- renderer-files && npm run build` then confirm `dist/renderer/fonts` holds both files. Expected: PASS, two files.

- [ ] **Step 5: Commit**

```bash
git add desktop/scripts/build.mjs desktop/src/renderer/index.html desktop/src/renderer/styles.css desktop/test/renderer-files.test.ts THIRD_PARTY.md
git commit -s -m "feat(desktop): bundle Geist so the app renders the same type everywhere"
```

### Task 2: Tokens, type scale and density

**Files:**
- Modify: `desktop/src/renderer/styles.css` (`:root`, the light block, `body`, `h1`/`h2`, `.eyebrow`, `.btn`, inputs, tables, `.panel`, `.side`, `.nav`, `.page`, `.head`)
- Test: `desktop/test/tokens.test.ts`

**Interfaces:**
- Produces: CSS custom properties `--canvas --panel --raised --fg --fg-2 --muted --accent --accent-ink --info --warning --danger` as `r g b` triplets, plus `--line` and `--edge` as `rgb(... / a)` colours (used as `var(--line)`, not `rgb(var(--line))`).

- [ ] **Step 1: Write the failing test**

A test that parses the `:root` and `@media (prefers-color-scheme: light)` blocks of `styles.css` with a regex into `{ name: [r,g,b] }`, then asserts WCAG contrast (write a 15-line `contrast(a, b)` helper in the test) for `fg`, `fg-2` and `muted` against `canvas` and `panel` is at least 4.5 in both modes, and `accent-ink` on `accent` at least 4.5.

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- tokens`. Expected: FAIL (the current cream palette passes contrast, so the failing assertion is on the exact new values: assert `canvas` equals `[9, 9, 9]` in dark).

- [ ] **Step 3: Rewrite the token blocks and the base scale**

Values from Global Constraints. Replace every `rgb(var(--line))` with `var(--line)` and `rgb(var(--edge))` with `var(--edge)` (`--line: rgb(255 255 255 / 0.08)` dark, `rgb(0 0 0 / 0.08)` light; `--edge` at 0.16). Body `13px/1.5 "Geist"`; `.lead`, `.msg`, `.hero-detail`, `.fg2` prose paragraphs on pages get `font-size: 14px` through a `.prose` class added where `app.ts` renders a paragraph under the page head (search `<p class="fg2">` at page top level in `overview`, `upload`, `market`, `ask`, `characters`, `addon`; add `prose`). `h1` 20 px, `h2` 14 px, `.eyebrow`/`th` 11 px. Rail 216, pad 24, nav buttons 30 px with 16 px icons, `.btn` and inputs 30 px, `.btn.small` 26 px, `th, td` padding `6px 10px`, `.panel` radius 8 px and padding `12px 14px`, `.confirm`/`.update-pop` radius 10 px, no box-shadow on panels (dialogs keep theirs).

- [ ] **Step 4: Run the tests, typecheck and build**

Run: `npm test && npm run typecheck && npm run build`. Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/styles.css desktop/src/renderer/app.ts desktop/test/tokens.test.ts
git commit -s -m "feat(desktop): neutral surfaces, a tighter type scale and denser controls"
```

### Task 3: State pills in the rail

**Files:**
- Create: `desktop/src/renderer/parts.ts`
- Modify: `desktop/src/renderer/app.ts:1061-1092` (`renderSide`: replace `dot(j)` in `item` with `statePill(j, s.engine.paused)`)
- Modify: `desktop/src/renderer/styles.css` (`.pill-s` styles; keep `.dot` for other uses)
- Test: `desktop/test/parts.test.ts`

**Interfaces:**
- Produces: `export function statePill(j: JobStatus, paused: boolean): string` returning `<span class="pill-s pill-<kind>"><i class="pill-ring" aria-hidden="true"></i>?<label></span>` where kind and label are: running → `working` "Working" (ring present), error → `failed` "Failed", ok → `ok` "OK", off → `off` "Off", idle → `waiting` "Waiting"; when `paused` and state is not `off`, kind `paused` label "Paused". The label is visible text, so the existing `sr-only` "(failed)/(running)" in `renderSide` is removed to avoid saying it twice.
- Produces: `export const esc` is imported from `./format`; `parts.ts` imports nothing from `app.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from "vitest";
import { statePill } from "../src/renderer/parts";
const j = (state: JobState) => ({ state, message: "", at: null });
test("each job state has a pill with a visible word", () => {
  expect(statePill(j("running"), false)).toContain("pill-working");
  expect(statePill(j("running"), false)).toContain("pill-ring");
  expect(statePill(j("error"), false)).toContain(">Failed<");
  expect(statePill(j("ok"), false)).toContain(">OK<");
  expect(statePill(j("off"), false)).toContain(">Off<");
  expect(statePill(j("idle"), false)).toContain(">Waiting<");
});
test("a paused engine says so for every job that is on", () => {
  expect(statePill(j("idle"), true)).toContain(">Paused<");
  expect(statePill(j("off"), true)).toContain(">Off<");
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- parts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `statePill` and wire it into `renderSide`**

CSS: `.pill-s` is `font-size: 11px; font-weight: 600; letter-spacing: 0.02em; padding: 1px 7px; border-radius: 9999px; margin-left: auto; border: 1px solid` with colours per kind: working `--info` on `rgb(var(--info) / 0.14)`, failed `--danger`, ok `--accent`, off `--muted` on transparent, waiting `--fg-2`, paused `--warning`. `.pill-ring` is a 10 px circle with a 1.5 px border, top segment in the pill colour, `animation: spin 900ms linear infinite` only under `prefers-reduced-motion: no-preference`.

- [ ] **Step 4: Run tests, typecheck, build**

Run: `npm test && npm run typecheck && npm run build`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/parts.ts desktop/src/renderer/app.ts desktop/src/renderer/styles.css desktop/test/parts.test.ts
git commit -s -m "feat(desktop): the rail says in a word what each job is doing"
```

### Task 4: The title bar

**Files:**
- Modify: `desktop/src/renderer/index.html` (wrap `<main>` in `<div class="col">` with `<header id="bar" class="bar" hidden></header>` before it)
- Modify: `desktop/src/renderer/app.ts` (`render()`: after `renderSide(state)` call `renderBar(state)`; add `function renderBar(s: AppState): void`; the welcome screen keeps the bar hidden)
- Modify: `desktop/src/renderer/parts.ts` (`watchPill`)
- Modify: `desktop/src/renderer/styles.css` (`.col`, `.bar`, `.crumb`, remove the per-page "Watching…" from `.head .sub` on Overview since the bar carries it)
- Test: `desktop/test/parts.test.ts`

**Interfaces:**
- Produces: `export function watchPill(e: Pick<EngineState, "files" | "paused">): string` → `<span class="pill-s pill-ok">Watching 1 file</span>`, plural "files", `pill-off` "Not watching" when none, `pill-paused` "Paused" when paused (paused wins).
- `renderBar` writes `<nav class="crumb" aria-label="Where you are"><span>Everloot</span><span class="sep" aria-hidden="true">/</span><strong>${label}</strong></nav>${watchPill(s.engine)}` where `label` is the current `PAGES` entry's label; the bar is `-webkit-app-region: drag`, its controls `no-drag`.

- [ ] **Step 1: Write the failing tests**

```ts
test("the watch pill counts files and says paused first", () => {
  expect(watchPill({ files: ["a"], paused: false })).toContain("Watching 1 file<");
  expect(watchPill({ files: ["a", "b"], paused: false })).toContain("Watching 2 files<");
  expect(watchPill({ files: [], paused: false })).toContain("Not watching");
  expect(watchPill({ files: ["a"], paused: true })).toContain(">Paused<");
});
```

- [ ] **Step 2: Run to see them fail** — `npm test -- parts`. Expected: FAIL, `watchPill` is not exported.

- [ ] **Step 3: Implement the bar**

CSS: `.shell` stays a two-column grid; `.col { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; min-width: 0; }`; `.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-height: 40px; padding: 0 var(--pad); border-bottom: 1px solid var(--line); background: rgb(var(--canvas)); font-size: 13px; }`; `.crumb { display: flex; gap: 8px; color: rgb(var(--muted)); } .crumb strong { color: rgb(var(--fg)); font-weight: 600; } .bar .pill-s { margin-left: auto; }`. The Overview `.head .sub` loses the watching text (the bar has it); the Overview head keeps the h1 only.

- [ ] **Step 4: Run tests, typecheck, build** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/index.html desktop/src/renderer/app.ts desktop/src/renderer/parts.ts desktop/src/renderer/styles.css desktop/test/parts.test.ts
git commit -s -m "feat(desktop): a title bar with the page and the watch state"
```

### Task 5: Honest empty states

**Files:**
- Modify: `desktop/src/renderer/parts.ts` (`emptyCause`, `emptyState`)
- Modify: `desktop/src/renderer/app.ts` (`characters()` line 580 branch, `upload()` account files and backups branches, `market()` scans and written branches, `ask()` pending and answers branches, `log()` when `logLines` is empty, `changes()` error branch)
- Modify: `desktop/src/renderer/styles.css` (`.empty`)
- Test: `desktop/test/parts.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type EmptyPage = "characters" | "upload" | "market" | "ask" | "log" | "changes";
  export interface Empty { cause: string; step: string; action?: { label: string; page?: Page; run?: Job; open?: string } }
  export function emptyCause(page: EmptyPage, s: Pick<AppState, "settings" | "engine">, extra?: { error?: string; haveFile?: boolean; followed?: number }): Empty
  export function emptyState(e: Empty, icon: string): string
  ```
  `emptyState` renders `<div class="empty">${icon}<div class="empty-text"><p class="empty-cause">…</p><p class="empty-step muted">…</p></div>${button}</div>` where the button is `<button type="button" class="btn small" data-page="…">` or `data-run="…"` or `data-open="…"` from `action`. `icon` is the page's icon markup, passed in by `app.ts` (`parts.ts` has no icon table).
- Cause rules (`emptyCause`), in order, first match wins:
  1. `!s.settings.gameFolder` → cause "Not watching a game folder", step "Choose it in Settings", action Settings.
  2. `s.engine.files.length === 0` → cause ``No Everloot.lua under ${gameFolder} yet``, step "Log out once in the game so it writes the file", no action.
  3. `s.engine.paused` → cause "Everloot is paused", step "Resume on the Overview", action Overview.
  4. page `upload` and `!s.settings.upload` → "Upload is off", step "Turn it on above", none. Page `ask` and `!s.settings.ask.enabled` → "/ask is off", "Turn it on above". Page `market` and `followed === 0` → "No realm followed yet", "Follow one below, or scan at the auction house".
  5. `extra.error` → cause `extra.error`, step "Try again", action `{ label: "Retry", page }`.
  6. Otherwise per page: characters "Save file read, no named character rows yet" / "The addon records gold and gear while you play"; upload "Nothing sent yet" / "The first upload runs after your next logout", action Upload now (`run: "upload"`); market "No full scan in your save file yet" / "At the auction house press Everloot scan"; ask "No question waiting" / "Type /ask in game, then /reload"; log "Nothing logged since start" / ""; changes "No changes fetched yet" / "".

- [ ] **Step 1: Write the failing tests**

```ts
const base = { settings: { gameFolder: "W:\\_classic_era_", upload: true, ask: { enabled: true } }, engine: { files: ["a"], paused: false } } as never;
test("no game folder beats everything", () => {
  const e = emptyCause("characters", { ...base, settings: { ...base.settings, gameFolder: "" } });
  expect(e.cause).toBe("Not watching a game folder"); expect(e.action?.page).toBe("settings");
});
test("a folder with no save file says the folder and the fix", () => {
  const e = emptyCause("upload", { ...base, engine: { files: [], paused: false } });
  expect(e.cause).toContain("W:\\_classic_era_"); expect(e.step).toContain("Log out once");
});
test("an off job says it is off before anything about data", () => {
  expect(emptyCause("ask", { ...base, settings: { ...base.settings, ask: { enabled: false } } }).cause).toBe("/ask is off");
});
test("the rendered block escapes the cause and wraps a long path", () => {
  const html = emptyState({ cause: "<b>" + "x".repeat(140), step: "" }, "");
  expect(html).toContain("&lt;b&gt;"); expect(html).toContain('class="empty"');
});
```

- [ ] **Step 2: Run to see them fail** — `npm test -- parts`. Expected: FAIL.

- [ ] **Step 3: Implement and wire the six pages**

CSS: `.empty { display: flex; align-items: flex-start; gap: 12px; padding: 14px; border: 1px dashed var(--edge); border-radius: 8px; overflow-wrap: anywhere; } .empty .ico { width: 18px; height: 18px; color: rgb(var(--muted)); margin-top: 1px; } .empty-cause { font-weight: 600; } .empty .btn { margin-left: auto; flex: none; }`. In `app.ts`, each listed branch replaces its `<p class="muted">…</p>` with `emptyState(emptyCause(page, s, extra), icon(page))`; `extra.error` from `data.changesError` / `m?.error`, `extra.followed` from `followed.size`.

- [ ] **Step 4: Run tests, typecheck, build** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/parts.ts desktop/src/renderer/app.ts desktop/src/renderer/styles.css desktop/test/parts.test.ts
git commit -s -m "feat(desktop): an empty page says why and what fills it"
```

### Task 6: Browser check, changelog, PR A

**Files:**
- Modify: `CHANGELOG.md` (new `## [desktop-v0.1.17] - 2026-11-03` section above `desktop-v0.1.16`, Added/Changed lines from Tasks 1 to 5)
- Modify: `desktop/package.json` (`"version": "0.1.17"`), `desktop/package-lock.json` (both version fields)
- Modify: `docs/media/desktop.webp` (a fresh Overview capture, converted with the same tool the repo used before; if none is documented, a PNG beside it and the README link updated)

- [ ] **Step 1: Run the app and capture dark and light**

Run in `desktop/`: `npm run build; npx electron . --remote-debugging-port=9333` (the installed app must be quit first, or use a second user data dir: `--user-data-dir` is not supported by this app, so quit the tray app). Then `node scripts/screenshot.mjs ../../tmp/overview-dark.png 9333` and the same with the expression `go("characters")`, `go("upload")`, `go("chat")`, `go("settings")`. For light, run with `--force-color-profile` unavailable; instead evaluate `matchMedia` cannot be forced, so set Windows to light mode with `Set-ItemProperty HKCU:\...\Themes\Personalize AppsUseLightTheme 1`, capture, then set back to 0. Resize the window to 640 px wide for one Overview capture.

- [ ] **Step 2: Inspect every capture against the spec's token table and Review Focus 3 and 4**; fix and re-capture until they hold.

- [ ] **Step 3: Keyboard pass**: Tab from the rail through a pill-bearing item, into an empty state's button, open Settings, open the Delete dialog and close it with Escape. Expected: the ring is visible on every stop.

- [ ] **Step 4: Changelog and version**, commit `chore(desktop): 0.1.17 changelog and version`.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin t3/sharpen-desktop-app
gh pr create --title "feat(desktop): a sharper shell with bundled Geist, live state pills and honest empty states" --body-file -
```
Body: what changed, the five captures attached, how it was tested, and "Fonts: Geist and Geist Mono, SIL OFL 1.1, from the geist package already used by the site". Wait for CI with the harness's PR watch; merge with `gh pr merge --squash --match-head-commit <sha>` once every check is green. Do **not** tag `desktop-v0.1.17`: the tag ships to every installed copy; Carlos tags after seeing the captures.

---

## Stage 2: PR B `feat(desktop): the app narrates its work and shows the character profile`

### Task 7: Log lines know their job

**Files:**
- Modify: `desktop/src/renderer/parts.ts` (`jobOfLine`, `threadLines`)
- Test: `desktop/test/parts.test.ts`
- Read first: `desktop/src/main/engine.ts` and `desktop/src/main/jobs.ts` for the exact prefixes the engine logs (today the Overview shows lines such as `upload TESTACC: sent 0 new events…`, `prices: 0 items on 0 realm(s) written…`); the test values below must match what the engine writes.

**Interfaces:**
- Produces: `export function jobOfLine(text: string): Job | "app"` → `"upload"` for lines starting `upload`, `"prices"` for `prices`, `"ask"` for `ask` or `/ask`, else `"app"`.
- Produces: `export function threadLines(log: LogLine[], n: number, icons: Record<Job | "app", string>): string` → the last `n` lines, oldest first, each `<div class="step step-<level>" data-job="<job>"><time>HH:MM</time>${icon}<span class="step-text">…</span></div>`; the newest line gets class `step-last`. Empty log → `""` (the caller renders the empty state).

- [ ] **Step 1: Write the failing tests**

```ts
test("a line's job comes from its prefix, and the rest belongs to the app", () => {
  expect(jobOfLine("upload TESTACC: sent 0 new events")).toBe("upload");
  expect(jobOfLine("prices: 0 items on 0 realm(s) written")).toBe("prices");
  expect(jobOfLine("ask: answered 1 question")).toBe("ask");
  expect(jobOfLine("Watching 1 account file(s) in W:\\_classic_era_")).toBe("app");
});
test("the thread keeps app lines, reads oldest first and marks the newest", () => {
  const log = [{ at: "2026-11-03T01:00:00Z", level: "info", text: "Watching 1 account file(s)" }, { at: "2026-11-03T01:01:00Z", level: "error", text: "upload X: failed" }] as LogLine[];
  const html = threadLines(log, 10, { upload: "U", prices: "P", ask: "A", app: "E" });
  expect(html.indexOf("Watching")).toBeLessThan(html.indexOf("failed"));
  expect(html).toContain('data-job="app"'); expect(html).toContain("step-error"); expect(html.match(/step-last/g)?.length).toBe(1);
});
```

- [ ] **Step 2: Run to see them fail.** Expected: FAIL, not exported.
- [ ] **Step 3: Implement both functions.**
- [ ] **Step 4: Run tests, typecheck.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): log lines are grouped by the job that wrote them`.

### Task 8: Working strips on Upload, Market and Ask

**Files:**
- Modify: `desktop/src/renderer/parts.ts` (`workingStrip`)
- Modify: `desktop/src/renderer/app.ts` (`upload()`, `market()`, `ask()`: the strip replaces the "Last run" panel on Upload and goes under the head on Market and Ask; the head keeps the switch and the run button)
- Modify: `desktop/src/renderer/styles.css` (`.strip`)
- Test: `desktop/test/parts.test.ts`

**Interfaces:**
- Produces: `export function workingStrip(job: Job, s: Pick<AppState, "engine" | "settings">, headline: string, lastLine: LogLine | null): string` → `<section class="strip strip-<kind>" aria-live="polite">${statePill(...)}<div class="strip-main"><p class="strip-head">${headline}</p>${lastLine ? `<p class="strip-last"><time>…</time> …</p>` : ""}</div></section>`. `kind` is the pill kind. The caller computes `headline` with `statusText(j)` from `format.ts` and `lastLine` as the newest log line whose `jobOfLine` is this job.

- [ ] **Step 1: Write the failing test**

```ts
test("a strip carries the pill, the headline and the job's last line", () => {
  const s = { engine: { jobs: { upload: { state: "running", message: "", at: null } }, paused: false, files: ["a"], log: [] }, settings: { upload: true } } as never;
  const html = workingStrip("upload", s, "Uploading TESTACC", { at: "2026-11-03T01:01:00Z", level: "info", text: "upload TESTACC: sending" });
  expect(html).toContain("pill-working"); expect(html).toContain("Uploading TESTACC"); expect(html).toContain("sending");
});
test("a paused engine's strip says Paused", () => { /* same with paused: true, state idle → ">Paused<" */ });
```

- [ ] **Step 2: Run to see it fail.** Expected: FAIL.
- [ ] **Step 3: Implement**, CSS `.strip { display: flex; gap: 12px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line); border-left: 3px solid; border-radius: 8px; background: rgb(var(--panel)); overflow-wrap: anywhere; }` with the left border colour by kind; `.strip-head { font-weight: 600; } .strip-last { font-size: 12px; color: rgb(var(--muted)); font-family: "Geist Mono"; } .strip time { margin-right: 8px; }`.
- [ ] **Step 4: Run tests, typecheck, build.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): each job page opens with what the job is doing`.

### Task 9: The Overview as a thread

**Files:**
- Modify: `desktop/src/renderer/app.ts:181-233` (`overview()`)
- Modify: `desktop/src/renderer/styles.css` (`.status-line`, `.thread-steps`, `.step`, `.ov-grid`; shrink `.hero` rules to the status line, delete `.hero-mark` and `HERO_GLYPH`/`heroMark` in `app.ts` once unused)
- Test: `desktop/test/parts.test.ts` (already covers `threadLines`); the page itself is checked in the browser pass

**Interfaces:**
- Consumes: `threadLines`, `statePill`, `emptyCause`/`emptyState`.
- Layout: `<div class="page"> head(h1 "Overview") · notices (unchanged) · <section class="status-line" data-state="…">pill · headline · detail · actions</section> · <div class="stats"> four `.stat` cells Upload / Market prices / /ask / Addon (from the current `job(...)` rows, one line each) </div> · <div class="ov-grid"><section><div class="sec-head"><h2>What Everloot did</h2><button data-page="log">open the log</button></div><div class="thread-steps">${threadLines(s.engine.log, 12, icons) || emptyState(emptyCause("log", s), icon("log"))}</div></section><section><div class="sec-head"><h2>Latest changes</h2>…</div>…</section></div></div>`. `.ov-grid` is `minmax(0, 1.4fr) minmax(0, 1fr)` and stacks under 820 px.

- [ ] **Step 1: Rewrite `overview()` to the layout above**, keeping every existing control id and `data-*` attribute (`pause`, `data-run`, `data-page`, `data-ask`, `updateNowCallout`, `updateRestartCallout`) so `onClick` keeps working.
- [ ] **Step 2: Run tests, typecheck, build; run the app and capture Overview in both modes.** Expected: the thread reads oldest to newest with the newest highlighted; no blank area with an empty log.
- [ ] **Step 3: Commit** `feat(desktop): the Overview reads as a thread of what the app did`.

### Task 10: Characters: ghost profile without data, profile on the page with data

**Files:**
- Modify: `desktop/src/renderer/parts.ts` (`ghostProfile`)
- Modify: `desktop/src/renderer/app.ts:538-602` (`characters()`), `603-632` (`drawerOverview` becomes `profileOverview(c)` used by both the page and the drawer)
- Modify: `desktop/src/renderer/styles.css` (`.ghost`, `.profile`)
- Test: `desktop/test/parts.test.ts`

**Interfaces:**
- Produces: `export function ghostProfile(): string` → `<div class="ghost" aria-hidden="true"><div class="char-hero"><section class="panel river-card"><h2>30-day money river</h2><div class="river"></div></section><section class="panel week-card"><h2>This week</h2><div class="week-bars">7 × <div class="wk-col"></div></div></section></div><section class="panel"><h2>Roster</h2><table>…3 empty rows…</table></section></div>`.
- With no named rows, `characters()` renders `emptyState(emptyCause("characters", s, { haveFile: Boolean(c) }), icon("characters"))` then `ghostProfile()`. With rows, the selected character's `profileOverview(c)` (stats, gear grid, money by category) renders on the page under the river and week cards in a `.profile` two-column grid, and the roster below; the drawer keeps using `profileOverview` for its Overview tab.

- [ ] **Step 1: Write the failing test**

```ts
test("the ghost profile is hidden from assistive tech and draws the three regions", () => {
  const html = ghostProfile();
  expect(html).toContain('aria-hidden="true"'); expect(html).toContain("river-card"); expect(html).toContain("week-card"); expect(html).toContain("Roster");
  expect((html.match(/wk-col/g) ?? []).length).toBe(7);
});
```

- [ ] **Step 2: Run to see it fail.** Expected: FAIL.
- [ ] **Step 3: Implement**; CSS `.ghost { opacity: 0.45; pointer-events: none; } .ghost .panel { border-style: dashed; } .ghost .river { height: 96px; border-bottom: 1px solid var(--line); } .ghost .wk-col { height: 68px; border-bottom: 1px solid var(--line); } .profile { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }` stacking under 820 px.
- [ ] **Step 4: Run tests, typecheck, build; capture Characters with and without data** (a fixture save file from `test/save-fixtures.ts` placed in a temporary game folder gives the with-data capture). Expected: PASS and both captures hold.
- [ ] **Step 5: Commit** `feat(desktop): Characters shows the profile, or its outline and why it is empty`.

### Task 11: Browser check, changelog, PR B

- [ ] **Step 1:** Captures of Overview, Upload, Market, Ask and Characters, dark and light, at 1200 px and 640 px wide; keyboard pass through a strip's action and the thread.
- [ ] **Step 2:** `CHANGELOG.md`: a `## [desktop-v0.1.18] - <date>` section, or add to 0.1.17's if PR A is not yet tagged (then bump nothing). Commit `chore(desktop): changelog for the narrated Overview and the profile`.
- [ ] **Step 3:** Branch `t3/desktop-narrates` from `main` after PR A merges (cherry-pick Tasks 7 to 10 if they were built on the PR A branch); push; `gh pr create --title "feat(desktop): the app narrates its work and shows the character profile"`; watch CI; merge with `--match-head-commit`.
