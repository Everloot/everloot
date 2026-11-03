// Renders the Everloot cards in cards.mjs to web/public/news/heroes/<slug>/:
//   <slug>-clean.webp  1600×900, the post's hero
//   <slug>-card.webp    800×450, the hub and related-post thumbnail
//   <slug>-share.png   1200×675, the share image
// Each size is drawn by the browser at its own scale, so small text stays sharp. Prints the alt text
// for each card. Usage, from this folder: node render.mjs [slug ...]   (no slug renders every card)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { altText, CARDS, shortDate } from "./cards.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const web = join(root, "web");
// The site's own fonts and image library, from web/node_modules (run `npm ci` in web/ first).
const requireWeb = createRequire(join(web, "package.json"));
const sharp = requireWeb("sharp");
const fontDir = join(web, "node_modules", "geist", "dist", "fonts");
const font = (file) => `data:font/woff2;base64,${readFileSync(join(fontDir, file)).toString("base64")}`;
const SANS = font("geist-sans/Geist-Variable.woff2");
const MONO = font("geist-mono/GeistMono-Variable.woff2");

// The site's dark tokens (web/src/design/tokens.ts).
const C = { canvas: "#0E0F0D", panel: "#15171A", line: "#3A3B35", fg: "#F4EFDD", fg2: "#C9C3B0", muted: "#8B8778", accent: "#9CF03A" };

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Escaped text that never breaks inside a date ("Oct 27") or a hyphenated word ("launch-week").
const text = (s) => esc(s).replace(/\b(Oct|October|Nov|November) (\d)/g, "$1&nbsp;$2")
  .replace(/(\S+-\S+)/g, '<span class="nb">$1</span>');
const FOOTER = "fan recap, not affiliated · everloot.app";

// The diamond from web/src/app/icon.svg.
const diamond = (size, stroke) => `<svg width="${size}" height="${size}" viewBox="8 8 48 48" aria-hidden="true"><path d="M32 12 52 32 32 52 12 32Z" fill="none" stroke="${C.accent}" stroke-width="${stroke}" stroke-linejoin="round"/></svg>`;

function html(card) {
  const headline = card.headline.map((p) => (typeof p === "string" ? text(p) : `<span class="a">${text(p.accent)}</span>`)).join(" ");
  const rows = card.panel.map((r) => `<div class="row"><div class="v${r.words ? " w" : ""}">${esc(r.value)}</div><div class="l"><span>${text(r.label)}</span></div></div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Geist; src: url(${SANS}) format("woff2"); font-weight: 100 900; }
@font-face { font-family: GeistMono; src: url(${MONO}) format("woff2"); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1600px; height: 900px; overflow: hidden; background: ${C.canvas}; }
body { position: relative; font-family: Geist, sans-serif; color: ${C.fg}; -webkit-font-smoothing: antialiased; }
.bg { position: absolute; inset: 0;
  background:
    radial-gradient(900px 640px at 78% 52%, rgba(156,240,58,.10), transparent 70%),
    linear-gradient(rgba(156,240,58,.045) 1px, transparent 1px) 0 0 / 64px 64px,
    linear-gradient(90deg, rgba(156,240,58,.045) 1px, transparent 1px) 0 0 / 64px 64px; }
.motif { position: absolute; left: -170px; top: -250px; width: 640px; height: 640px; transform: rotate(45deg);
  border: 3px solid rgba(156,240,58,.16); }
.motif.in { left: -90px; top: -170px; width: 480px; height: 480px; border-color: rgba(156,240,58,.08); }
.frame { position: absolute; inset: 20px; border: 1px solid ${C.line}; border-radius: 12px; }
.top { position: absolute; left: 80px; top: 76px; display: flex; align-items: center; gap: 22px;
  font-family: GeistMono, monospace; font-size: 21px; letter-spacing: .16em; text-transform: uppercase; }
.chip { background: ${C.accent}; color: ${C.canvas}; font-weight: 700; padding: 9px 16px 8px; border-radius: 4px; }
.date { color: ${C.fg2}; font-weight: 500; }
.left { position: absolute; left: 80px; top: 170px; width: 700px; height: 560px; display: flex; flex-direction: column; justify-content: center; }
h1 { font-weight: 800; font-size: 86px; line-height: 1.02; letter-spacing: -0.025em; text-wrap: balance; }
h1 .a { color: ${C.accent}; white-space: nowrap; }
.nb { white-space: nowrap; }
.take { margin-top: 34px; font-size: 29px; line-height: 1.38; color: ${C.fg2}; max-width: 640px; text-wrap: pretty; }
.panel { position: absolute; left: 852px; top: 150px; width: 668px; height: 600px; padding: 34px 40px;
  background: rgba(21,23,26,.92); border: 2px solid rgba(156,240,58,.75); border-radius: 12px;
  box-shadow: 0 0 0 1px rgba(156,240,58,.10), 0 0 60px rgba(156,240,58,.16); display: flex; flex-direction: column; }
.pt { font-family: GeistMono, monospace; font-size: 19px; letter-spacing: .18em; text-transform: uppercase; color: ${C.accent}; font-weight: 600;
  padding-bottom: 18px; border-bottom: 1px solid ${C.line}; }
.rows { flex: 1; display: grid; grid-template-columns: max-content 1fr; align-content: space-evenly; }
.row { display: contents; }
.v, .l { padding: 12px 0; border-bottom: 1px solid ${C.line}; align-self: stretch; display: flex; align-items: center; }
.row:last-child .v, .row:last-child .l { border-bottom: 0; }
.v { padding-right: 32px; font-family: GeistMono, monospace; font-weight: 600; font-size: var(--vs, 56px); letter-spacing: -0.02em; word-spacing: -0.3em; color: ${C.fg}; white-space: nowrap; }
.v.w { font-family: Geist, sans-serif; font-weight: 750; font-size: calc(var(--vs, 56px) * .9); letter-spacing: -0.02em; word-spacing: normal; }
.l { font-family: GeistMono, monospace; font-size: 18px; line-height: 1.4; letter-spacing: .1em; text-transform: uppercase; color: ${C.fg2}; }
.brand { position: absolute; left: 80px; bottom: 66px; display: flex; align-items: center; gap: 16px; font-weight: 700; font-size: 42px; letter-spacing: -0.02em; }
.foot { position: absolute; right: 80px; bottom: 76px; font-family: GeistMono, monospace; font-size: 20px; letter-spacing: .04em; color: ${C.muted}; }
</style></head><body>
<div class="bg"></div><div class="motif"></div><div class="motif in"></div><div class="frame"></div>
<div class="top"><span class="chip">${esc(card.tag)}</span><span class="date">${shortDate(card.date)} · WoW: Forever</span></div>
<div class="left"><h1>${headline}</h1><p class="take">${text(card.takeaway)}</p></div>
<div class="panel"><div class="pt">${esc(card.panelTitle)}</div><div class="rows">${rows}</div></div>
<div class="brand">${diamond(34, 5)}<span>everloot</span></div>
<div class="foot">${esc(card.source)} · ${FOOTER}</div>
<script>
// Shrink the headline and the panel values until they fit their boxes.
const fit = () => {
  const left = document.querySelector(".left"), h1 = document.querySelector("h1");
  for (let s = 86; (left.scrollHeight > left.clientHeight || h1.scrollWidth > h1.clientWidth) && s > 48; s -= 2) h1.style.fontSize = s + "px";
  const panel = document.querySelector(".panel"), rows = document.querySelector(".rows");
  for (let s = 56; (panel.scrollHeight > panel.clientHeight || rows.scrollWidth > rows.clientWidth) && s > 30; s -= 2) panel.style.setProperty("--vs", s + "px");
};
document.fonts.ready.then(() => { fit(); document.body.dataset.ready = "1"; });
</script>
</body></html>`;
}

const SIZES = [
  { suffix: "clean.webp", scale: 1, encode: (img) => img.webp({ quality: 90, effort: 6 }) },
  { suffix: "card.webp", scale: 0.5, encode: (img) => img.webp({ quality: 88, effort: 6 }) },
  { suffix: "share.png", scale: 0.75, encode: (img) => img.png({ compressionLevel: 9, palette: false }) },
];

const wanted = process.argv.slice(2);
const cards = wanted.length ? CARDS.filter((c) => wanted.includes(c.slug)) : CARDS;
if (wanted.length && cards.length !== wanted.length) throw new Error(`No card for: ${wanted.filter((s) => !CARDS.some((c) => c.slug === s)).join(", ")}`);

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    for (const card of cards) {
      // A fresh page per card: a reused page never reports its fonts ready a second time.
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: size.scale });
      page.on("pageerror", (e) => console.error(`${card.slug}: ${e.message}`));
      await page.setContent(html(card));
      await page.waitForSelector("body[data-ready]");
      const png = await page.screenshot({ type: "png" });
      await page.close();
      const out = join(web, "public", "news", "heroes", card.slug);
      mkdirSync(out, { recursive: true });
      const file = join(out, `${card.slug}-${size.suffix}`);
      writeFileSync(file, await size.encode(sharp(png)).toBuffer());
      const meta = await sharp(file).metadata();
      console.log(`${meta.width}x${meta.height}  ${file.slice(root.length + 1)}`);
    }
  }
} finally {
  await browser.close();
}
for (const card of cards) {
  const alt = altText(card);
  if (alt.length > 500) throw new Error(`${card.slug}: alt text is ${alt.length} characters, over 500`);
  console.log(`\n${card.slug} (${alt.length} chars)\n${alt}`);
}
