import type { ReactNode } from "react";
import GameIcon from "@/components/game/GameIcon";
import Glint from "@/components/glint/Glint";

/** The game's icons for the suggestion cards, read by the page from the asset manifest; absent without the asset URL. */
export interface ChatIcons { warrior?: string; tailoring?: string }

type Glyph = "item" | "class" | "changes" | "market";

/** The four starting questions, each with the game icon (when the page has one) or a drawn glyph. */
export const WELCOME: { text: string; glyph: Glyph; icon?: keyof ChatIcons }[] = [
  { text: "Where does Linen Cloth drop?", glyph: "item", icon: "tailoring" },
  { text: "Plan a level 40 Fury warrior", glyph: "class", icon: "warrior" },
  { text: "What changed in the last build?", glyph: "changes" },
  { text: "What sells best on my realm?", glyph: "market" },
];

const PATHS: Record<Glyph, ReactNode> = {
  item: <path d="M12 3 20 12 12 21 4 12Z" />,
  class: <><path d="M14.5 4.5 19.5 4.5 19.5 9.5 10 19 5 14Z" /><path d="m4 20 3-3" /></>,
  changes: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  market: <><ellipse cx="12" cy="7" rx="7" ry="3" /><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7" /><path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></>,
};

function Icon({ glyph, src }: { glyph: Glyph; src?: string }) {
  if (src) return <GameIcon src={src} size={32} />;
  return (
    <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-control border border-line bg-canvas text-accent">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{PATHS[glyph]}</svg>
    </span>
  );
}

/**
 * The empty chat: Glint, a short welcome in the home hero's type, and the starting questions as cards. A card
 * sends its question the way Send does. Glint is decorative and holds still under reduced motion.
 */
export default function ChatWelcome({ icons = {}, disabled, onAsk, children }: {
  icons?: ChatIcons;
  disabled: boolean;
  onAsk: (question: string) => void;
  /** Anything the empty chat adds under the cards (where the chat is kept). */
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center sm:gap-6">
      <Glint size={88} className="size-14 sm:size-[88px]" />
      <div className="space-y-2 sm:space-y-3">
        <h2 className="text-2xl font-bold leading-tight tracking-tight text-fg sm:text-4xl">
          Ask anything.<br /><span className="text-accent">See where it comes from.</span>
        </h2>
        <p className="mx-auto max-w-[44ch] text-sm text-fg-2 sm:text-base">Items, quests, classes, prices and patch changes, answered from Everloot&apos;s data with links to the pages.</p>
      </div>
      <ul aria-label="Suggestions" className="grid w-full max-w-2xl gap-2 sm:grid-cols-2">
        {WELCOME.map((s) => (
          <li key={s.text} className="flex">
            <button type="button" disabled={disabled} onClick={() => onAsk(s.text)}
              className="flex min-h-12 w-full items-center gap-3 rounded-card border border-line bg-panel px-3 py-1.5 text-left text-sm text-fg transition-colors hover:border-accent disabled:opacity-60 disabled:hover:border-line">
              <Icon glyph={s.glyph} src={s.icon ? icons[s.icon] : undefined} />
              <span>{s.text}</span>
            </button>
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}
