import { timeLeft, waitText } from "@/components/LaunchCountdown";
import { LAUNCH, LAUNCH_AT, longDate } from "@/data/wow-forever";

/** One thing Glint says. `{when}` in `text` is the launch time, drawn as a <time> linked to /wow-forever. */
export type GlintLine = { id: string; text: string; when?: string };

/** What he says when the pointer finds him. */
export const LOOT_GET: GlintLine = { id: "loot-get", text: "Loot get!" };

/**
 * The home hero's speech bubble, in order. `now` is null on the server and before hydration: before launch the line
 * then names the date, so it is right without JavaScript, and after launch the server's own clock picks the live lines.
 * Once Forever is out the lines are about looting it.
 */
export function heroLines(now: number | null, at = Date.parse(LAUNCH_AT)): GlintLine[] {
  const left = now === null ? (Date.now() >= at ? null : undefined) : timeLeft(now, at);
  if (left === null) {
    return [
      { id: "live", text: "Forever is live. Show me what you looted!" },
      { id: "find", text: "Haven't seen that one drop yet. Help me find it?" },
      { id: "addon", text: "Install the addon and every drop you see lands here." },
    ];
  }
  const countdown: GlintLine = left
    ? { id: "countdown", text: "{when} until Forever. My satchel's ready!", when: waitText(left) }
    : { id: "countdown", text: "Forever launches {when}. My satchel's ready!", when: `${longDate(LAUNCH.date)}, 3:00 p.m. PST` };
  return [
    countdown,
    { id: "drops", text: "Haven't seen a single drop yet. Help me find them?" },
    { id: "addon", text: "Install the addon and every drop you see lands here." },
  ];
}

/** The footer's perch: one of these each time he is hovered, focused or clicked. */
export const FOOTER_LINES: GlintLine[] = [
  LOOT_GET,
  { id: "remember", text: "I remember every drop." },
  { id: "agree", text: "Three installs agree, then it's a fact." },
  { id: "satchel", text: "Room in the satchel for one more." },
];

/** The line as plain words, for screen-reader announcements and tests. */
export const lineText = (line: GlintLine): string => line.text.replace("{when}", line.when ?? "");
