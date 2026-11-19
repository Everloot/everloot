import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import { CAPTION_SIZE, cssVariables, DATA_SIZE, DATA_TYPE, MEASURE, MOTION, motionVariables, RADIUS, SITE_MODE, tokens, WIDTH, type TokenName } from "./src/design/tokens";

const tokenColors = Object.fromEntries(
  (Object.keys(tokens.dark) as TokenName[]).map((name) => [name, `rgb(var(--${name}) / <alpha-value>)`]),
);

const px = (n: number) => `${n}px`;
// The data-page type: `text-title`, `text-meta`, `text-th`… Titles, section headings and table
// headers carry their weight, so one class sets the whole step.
const WEIGHT: Partial<Record<keyof typeof DATA_TYPE, string>> = { title: "700", "title-sm": "700", h2: "600", "h2-sm": "600", th: "600" };
type FontStep = [string, { lineHeight: string; fontWeight?: string; letterSpacing?: string }];
const dataFontSize: Record<string, FontStep> = Object.fromEntries(
  (Object.keys(DATA_TYPE) as (keyof typeof DATA_TYPE)[]).map((step): [string, FontStep] => {
    const [size, line] = DATA_TYPE[step];
    return [step, [px(size), {
      lineHeight: px(line),
      ...(WEIGHT[step] ? { fontWeight: WEIGHT[step] } : {}),
      ...(step.startsWith("title") ? { letterSpacing: "-0.01em" } : {}),
    }]];
  }),
);
const dataSize = Object.fromEntries(Object.entries(DATA_SIZE).map(([name, n]) => [name, px(n)]));

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: tokenColors,
      maxWidth: { reading: `${WIDTH.reading}px`, wide: `${WIDTH.wide}px`, data: `${WIDTH.data}px`, tip: px(DATA_SIZE.tip), prose: `${MEASURE.prose}ch`, lede: `${MEASURE.lede}ch` },
      fontSize: { ...dataFontSize, caption: px(CAPTION_SIZE) },
      // `h-row`, `h-th`, `h-control`, `min-h-row-sm`…, and `top-header` for sticky table headers.
      height: dataSize,
      minHeight: dataSize,
      inset: { header: px(DATA_SIZE.header) },
      borderRadius: { control: `${RADIUS.control}px`, card: `${RADIUS.card}px` },
      // The 72 px step of the spacing scale; the others are Tailwind's own (1 2 3 4 6 8 12).
      spacing: { 18: "4.5rem" },
      // Motion from the tokens: `duration-fade`, `ease-out`, and one default curve for every `transition-*`.
      transitionDuration: { DEFAULT: `${MOTION.duration.fade}ms`, fade: `${MOTION.duration.fade}ms` },
      transitionTimingFunction: { DEFAULT: MOTION.ease.color, out: MOTION.ease.out },
      fontFamily: {
        // Geist for reading, Geist Mono for anything precise (variables set in src/app/fonts.ts).
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [
    // Dark-only: the system's light setting no longer switches the page to cream. A light theme
    // would come back as one more selector here with cssVariables("light"). Tooltip frames stay
    // dark in every mode, as in the game, so they re-declare the dark variables for their contents.
    plugin(({ addBase }) => {
      addBase({
        ":root": { ...cssVariables(SITE_MODE), ...motionVariables() },
        ".bg-tooltip": cssVariables("dark"),
      });
    }),
  ],
};
export default config;
