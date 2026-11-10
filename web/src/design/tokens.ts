// The site's colours, spacing, corners and widths. The only place hex values live (besides icon.svg).
// Tailwind reads the colours as CSS variables. The site is dark-only: every visitor gets the dark
// values. The light values are kept, and kept passing, so a light theme can return later by
// emitting them under a selector of its own. Every text token passes 4.5:1 on canvas and panel
// (tokens.test.ts).

export type Mode = "dark" | "light";

/** The mode every visitor sees. */
export const SITE_MODE: Mode = "dark";

/** One spacing scale, in px. Tailwind steps 1 2 3 4 6 8 12 18 (18 is added in tailwind.config.ts). */
export const SPACE = [4, 8, 12, 16, 24, 32, 48, 72] as const;

/** Corners: `rounded-card` for every card, table frame and panel; `rounded-control` for inputs,
 *  icons and the tooltip frame; `rounded-full` for buttons, badges and pills. */
export const RADIUS = { control: 6, card: 12 } as const;

/** Three content widths: `reading` for documents, `wide` for tools and hubs, `data` for the database,
 *  search and the item, NPC and quest pages. The header, the footer and <main> run at `data` (1440 with
 *  24 px sides, 16 px under 1024 px), and every page's column starts at its left edge. */
export const WIDTH = { reading: 768, wide: 1152, data: 1440 } as const;

/**
 * The data-page scale (density spec, 2026-10-20): `/database/*`, `/search` and the item, NPC and
 * quest pages. Prose pages keep Tailwind's own scale. Each step is [font-size, line-height] in px;
 * the `-sm` steps are the phone values (< 640 px), so a title reads `text-title-sm sm:text-title`.
 * Rhythm on those pages uses the spacing scale: header to title 16, title to filter bar 12,
 * filter bar to table 8, between sections 24.
 */
export const DATA_TYPE = {
  /** Page title: 700, tracking -0.01em. */
  title: [28, 34],
  "title-sm": [22, 28],
  /** Section heading: 600. */
  h2: [16, 24],
  "h2-sm": [15, 22],
  /** Body and table cells. */
  cell: [14, 20],
  /** Meta lines (muted). */
  meta: [13, 20],
  /** A cell's second line (muted). */
  "cell-2": [12, 16],
  /** Table headers: 600, sans (never mono), muted. */
  th: [12, 16],
  /** Filter buttons, the pager and tabs. */
  control: [13, 20],
  /** Tooltip box text. */
  tip: [13, 18],
} as const;

/** Sizes on data pages, in px: rows (36; two-line 52 on phones), the 32 px table header, controls
 *  (32; 40 on phones), the 24 px row icon, the sticky offset under the 44 px site header, and the
 *  tooltip box's 320 px limit. */
export const DATA_SIZE = { row: 36, "row-sm": 52, th: 32, control: 32, "control-sm": 40, icon: 24, header: 44, tip: 320 } as const;

/**
 * Motion (visual identity spec, item 12: fades and small purposeful transforms, none under
 * `prefers-reduced-motion`). Durations in ms, curves as CSS timing functions. Tailwind's `duration-fade`, `ease-out`
 * and default curve, and the CSS variables `--dur-*` and `--ease-*`, come from here; nothing else types a duration
 * or a curve.
 */
export const MOTION = {
  duration: {
    /** A button's press (scale 0.98). */
    press: 100,
    /** A menu closing: faster than it opened. */
    exit: 100,
    /** The site's one fade: menus opening, label swaps, the navigation bar. Colour changes too. */
    fade: 150,
    /** A raid member gliding to its new slot (FLIP); the phone sheet closing. */
    panel: 200,
    /** The phone account sheet sliding up; the only 300. */
    sheet: 300,
    /** The navigation bar growing towards 90 % while a page loads. */
    grow: 2000,
    /** The wait before the navigation bar shows, so a fast page change never flashes it. */
    pendingDelay: 150,
    /** How long a copy button says "Copied". */
    copied: 2000,
  },
  ease: {
    /** Entrances and feedback: anything answering the user. */
    out: "cubic-bezier(0.23, 1, 0.32, 1)",
    /** Something moving from one place on screen to another (the raid glide). */
    inOut: "cubic-bezier(0.77, 0, 0.175, 1)",
    /** The phone sheet. */
    drawer: "cubic-bezier(0.32, 0.72, 0, 1)",
    /** Hover colour changes, and the default for every transition. */
    color: "ease",
  },
  /**
   * Glint, the loot raven (components/glint), the one character the owner asked to move (2026-10-20): slow idle
   * loops, a blink, a wing flap, and the turn of his speech bubble. All of it stops under `prefers-reduced-motion`.
   */
  glint: {
    duration: {
      /** One breath: the body rises and settles. */
      bob: 3200,
      /** The cycle the occasional head tilt sits in. */
      tilt: 9000,
      /** The cycle the gem's sparkle sits in. */
      sparkle: 4200,
      /** One blink; the wait between blinks is random, from blinkMin to blinkMax. */
      blink: 160,
      blinkMin: 3000,
      blinkMax: 6000,
      /** A two-beat wing flap on hover or click. */
      flap: 640,
      /** How long each line in the speech bubble stays. */
      line: 6000,
      /** How long "Loot get!" stays after a hover or click. */
      pop: 2400,
    },
    /** The idle loops' curve (ease-in-out sine). */
    ease: "cubic-bezier(0.37, 0, 0.63, 1)",
  },
} as const;

/** The motion tokens as CSS variables, for globals.css, world-map.css and glint.css. */
export function motionVariables(): Record<string, string> {
  const glint = MOTION.glint.duration;
  return {
    "--dur-press": `${MOTION.duration.press}ms`,
    "--dur-exit": `${MOTION.duration.exit}ms`,
    "--dur-fade": `${MOTION.duration.fade}ms`,
    "--dur-panel": `${MOTION.duration.panel}ms`,
    "--dur-sheet": `${MOTION.duration.sheet}ms`,
    "--dur-grow": `${MOTION.duration.grow}ms`,
    "--ease-out": MOTION.ease.out,
    "--ease-drawer": MOTION.ease.drawer,
    "--ease-color": MOTION.ease.color,
    "--dur-glint-bob": `${glint.bob}ms`,
    "--dur-glint-tilt": `${glint.tilt}ms`,
    "--dur-glint-sparkle": `${glint.sparkle}ms`,
    "--dur-glint-blink": `${glint.blink}ms`,
    "--dur-glint-flap": `${glint.flap}ms`,
    "--ease-glint": MOTION.glint.ease,
  };
}

/**
 * Glint's flat colours, from the mascot's brand brief: a near-black raven
 * with blue-black highlights, a gold beak and talons, Everloot-green eyes, a brown leather satchel, and a cream
 * sticker edge so the dark bird reads on the dark canvas. The gem takes the accent or an item-quality colour.
 */
export const GLINT = {
  outline: "#050605",
  body: "#15181F",
  sheen: "#33405F",
  gold: "#F5B726",
  goldShade: "#C9870F",
  leather: "#8E5A2B",
  leatherShade: "#673F1C",
  eye: "#9CF03A",
  shine: "#F4EFDD",
  sticker: "#F4EFDD",
} as const;

export const QUALITIES = ["poor", "common", "uncommon", "rare", "epic", "legendary"] as const;
export const CLASSES = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"] as const;
/** The realm rulesets' slugs, as ../data/realms.ts `RULESET_SLUGS`, for their name colours. */
export const REALM_RULESETS = ["normal", "pvp", "rp", "rp-pvp", "hardcore"] as const;

export type TokenName =
  | "canvas" | "panel" | "line" | "edge" | "fg" | "fg-2" | "muted" | "accent" | "danger" | "warning"
  | "tooltip" | "tooltip-border" | "tooltip-inner" | "accent-hover" | "blue-post"
  | `q-${(typeof QUALITIES)[number]}` | `class-${(typeof CLASSES)[number]}` | "chat-whisper" | "chat-guild"
  | `realm-${(typeof REALM_RULESETS)[number]}` | "tip-yellow" | "coin-gold" | "coin-silver" | "coin-copper";

// Tooltip frames stay dark in both modes, as in the game.
const tooltip = { tooltip: "#080C18", "tooltip-border": "#5B6B8C", "tooltip-inner": "#26324F" } as const;

export const tokens: Record<Mode, Record<TokenName, string>> = {
  dark: {
    canvas: "#0E0F0D",
    panel: "#15171A",
    line: "#3A3B35",
    // Control edges (inputs, filter chips): at least 3:1 on canvas and panel, unlike the decorative line.
    edge: "#6E6B60",
    fg: "#F4EFDD",
    "fg-2": "#C9C3B0",
    muted: "#8B8778",
    accent: "#9CF03A",
    danger: "#FF6B6B",
    warning: "#F5B83D",
    ...tooltip,
    // The primary button's fill on hover; its text is the canvas colour.
    "accent-hover": "#B3F566",
    // Blizzard's own posts (forum and Bluesky, posts and hotfixes; not builds) in the blue of a blue post.
    "blue-post": "#00B4FF",
    "q-poor": "#9D9D9D",
    "q-common": "#F2F4F8",
    "q-uncommon": "#1EFF00",
    "q-rare": "#4C9BFF",
    "q-epic": "#BE73F7",
    "q-legendary": "#FF8A1A",
    "class-warrior": "#C69B6D",
    "class-paladin": "#F48CBA",
    "class-hunter": "#AAD372",
    "class-rogue": "#FFF468",
    "class-priest": "#FFFFFF",
    "class-shaman": "#2E8BFF",
    "class-mage": "#3FC7EB",
    "class-warlock": "#8788EE",
    "class-druid": "#FF7C0A",
    "chat-whisper": "#FF80FF",
    "chat-guild": "#40FF40",
    // A realm's ruleset beside its name (tools/auctions/RealmName.tsx): red PvP, green PvE, blue RP, orange RP-PvP, gold Hardcore.
    "realm-normal": "#66D966",
    "realm-pvp": "#FF4C4C",
    "realm-rp": "#73B3FF",
    "realm-rp-pvp": "#FF8040",
    "realm-hardcore": "#FFD100",
    // Item tooltip lines (components/ui/TooltipLines.tsx): the game's yellow for the item level, a set and the
    // flavour text, and the three coin metals of a sell price.
    "tip-yellow": "#FFD100",
    "coin-gold": "#F2C230",
    "coin-silver": "#C7C7CF",
    "coin-copper": "#E39B5B",
  },
  light: {
    canvas: "#FBF8EC",
    panel: "#FFFFFF",
    line: "#D9D3BF",
    edge: "#8A8473",
    fg: "#12130F",
    "fg-2": "#3E3B32",
    muted: "#5F5B4E",
    accent: "#2F7A0A",
    danger: "#C62828",
    warning: "#8A5A00",
    ...tooltip,
    "accent-hover": "#256207",
    "blue-post": "#006A99",
    "q-poor": "#6B6B6B",
    "q-common": "#12130F",
    "q-uncommon": "#1A7A12",
    "q-rare": "#0057AD",
    "q-epic": "#7A23C0",
    "q-legendary": "#A84B00",
    "class-warrior": "#85592C",
    "class-paladin": "#A8326E",
    "class-hunter": "#4A7320",
    "class-rogue": "#746500",
    "class-priest": "#12130F",
    "class-shaman": "#0057AD",
    "class-mage": "#0B6E87",
    "class-warlock": "#4A4BC0",
    "class-druid": "#A84B00",
    "chat-whisper": "#A3218F",
    "chat-guild": "#1A7A12",
    "realm-normal": "#1A7A12",
    "realm-pvp": "#C62828",
    "realm-rp": "#0057AD",
    "realm-rp-pvp": "#A84B00",
    "realm-hardcore": "#746500",
    "tip-yellow": "#746500",
    "coin-gold": "#7A5C00",
    "coin-silver": "#5E5E66",
    "coin-copper": "#8A4B14",
  },
};

export const TEXT_TOKENS: TokenName[] = [
  "fg", "fg-2", "muted", "accent", "danger", "warning", "blue-post",
  ...QUALITIES.map((q) => `q-${q}` as const),
  ...CLASSES.map((c) => `class-${c}` as const),
  "chat-whisper", "chat-guild",
  ...REALM_RULESETS.map((r) => `realm-${r}` as const),
  "tip-yellow", "coin-gold", "coin-silver", "coin-copper",
];

/** "#0E0F0D" -> "14 15 13", the form `rgb(var(--x) / <alpha-value>)` needs. */
export function channels(hex: string): string {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");
}

export function cssVariables(mode: Mode): Record<string, string> {
  return Object.fromEntries(Object.entries(tokens[mode]).map(([name, hex]) => [`--${name}`, channels(hex)]));
}
