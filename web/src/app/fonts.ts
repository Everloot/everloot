import localFont from "next/font/local";

// Geist and Geist Mono, self-hosted from the geist package (SIL OFL 1.1); the build fetches nothing. These are the
// same two variable files geist/font/sans and geist/font/mono serve, loaded here so the fallback stack is ours.
// Sets --font-geist-sans and --font-geist-mono, which tailwind.config.ts uses.
//
// The display mode stays swap (next/font's default): text shows at once in a system face and then swaps. The swap
// moves layout only by the difference in width, so each stack names GeistSansFallback or GeistMonoFallback first:
// @font-face rules in globals.css that wrap Arial and Courier New with size-adjust and the ascent, descent and
// line-gap overrides that make them occupy the space Geist does. next/font's own fallback was off for both: for Geist Sans it used one
// size-adjust (106.28%) for every weight, 4% too wide at 400 and a little narrow at 600, and Geist Mono had none.
const geistSans = localFont({
  src: "../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  adjustFontFallback: false,
  fallback: ["GeistSansFallback"],
});

const geistMono = localFont({
  src: "../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  adjustFontFallback: false,
  fallback: [
    "GeistMonoFallback",
    "ui-monospace",
    "SFMono-Regular",
    "Roboto Mono",
    "Menlo",
    "Monaco",
    "Liberation Mono",
    "DejaVu Sans Mono",
    "Courier New",
    "monospace",
  ],
});

export const fontVariables = `${geistSans.variable} ${geistMono.variable}`;
