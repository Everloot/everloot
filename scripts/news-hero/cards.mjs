// One entry per news post that uses an Everloot card as its hero. Every fact on a card is taken from
// the post itself (kb/news/<slug>.md): dates, numbers and wording. Change the post first, then the card.
//
// tag:      the post's main topic, shown in the chip top left. Never "BLUE POST": that names a Blizzard
//           staff post, and these cards are Everloot's own.
// date:     the post's `published` date.
// headline: short, from the post's title. `accent` is the part drawn in green.
// takeaway: one line from the post's TL;DR.
// panel:    the facts on the right. `value` is drawn large (mono for numbers, sans for words).
// source:   who the facts come from, as the post says, shown in the footer.

export const CARDS = [
  {
    slug: "wow-forever-4-month-patch-cadence",
    tag: "Patch cadence",
    date: "2026-10-30",
    headline: ["Aiming for a", { accent: "4-month" }, "patch cadence"],
    takeaway: "PvP seasons will also run 4 months, and some content will unlock between major patches.",
    panelTitle: "The plan",
    panel: [
      { value: "~4 mo", label: "Between major patches" },
      { value: "~3", label: "Major patches a year" },
      { value: "4 mo", label: "PvP season length" },
      { value: "8–10 wk", label: "Season of Discovery patches, felt too fast" },
    ],
    source: "per Blizzard to IGN",
  },
  {
    slug: "wow-forever-beta-closed-priority-fixes-podcast",
    tag: "Beta",
    date: "2026-10-26",
    headline: ["Beta closed.", { accent: "Priority fixes," }, "then launch Nov 4"],
    takeaway: "No more beta access. Your next login is character creation on Oct 27.",
    panelTitle: "What comes next",
    panel: [
      { value: "5 weeks", label: "Beta, now officially closed" },
      { value: "A few days", label: "Focused work on priority issues", words: true },
      { value: "Oct 27", label: "Character creation opens" },
      { value: "Nov 4", label: "Launch" },
    ],
    source: "per Blizzard",
  },
  {
    slug: "wow-forever-character-creation-opens-tomorrow-checklist",
    tag: "Checklist",
    date: "2026-10-26",
    headline: ["Character creation", { accent: "opens tomorrow" }],
    takeaway: "Up to 3 characters total across all rulesets until November 3. Install the client today.",
    panelTitle: "Start times",
    panel: [
      { value: "1:00 PM PDT", label: "North America, Oct 27" },
      { value: "18:00 CET", label: "Europe, Oct 27" },
      { value: "07:00", label: "Korea and Taiwan, Oct 28, local" },
      { value: "3", label: "Characters total, all rulesets" },
    ],
    source: "per Blizzard",
  },
  {
    slug: "wow-forever-launch-week-checklist-nov-4",
    tag: "Launch",
    date: "2026-10-30",
    headline: ["Launches", { accent: "Nov 4:" }, "your launch-week checklist"],
    takeaway: "Your first login asks for an Experience Preset. Blizzard says to start with Enhanced if unsure.",
    panelTitle: "At launch",
    panel: [
      { value: "1–60", label: "Eastern Kingdoms and Kalimdor" },
      { value: "1,000+", label: "New quests" },
      { value: "9", label: "New five-player dungeons, levels 13–60" },
      { value: "3:00 PM", label: "Pacific, Nov 4, per Wowhead" },
    ],
    source: "per Blizzard's launch guide",
  },
  {
    slug: "wow-forever-layering-world-refresh-fixes",
    tag: "Layering",
    date: "2026-10-30",
    headline: ["Fewer forced", { accent: "world refreshes" }, "at launch"],
    takeaway: "Joining a group won't instantly move you to a new layer. You'll get a pop-up and a time window instead.",
    panelTitle: "What changes",
    panel: [
      { value: "Pop-up", label: "On group join, not an instant move", words: true },
      { value: "Rarer", label: "Forced refreshes, than in the Beta", words: true },
      { value: "Stays", label: "Zone-to-zone layering, for now", words: true },
      { value: "As in Beta", label: "Big world PvP at launch", words: true },
    ],
    source: "per the WoW: Forever Podcast",
  },
  {
    slug: "wow-forever-molten-core-new-mechanics-raid-tease",
    tag: "Raids",
    date: "2026-10-26",
    headline: [{ accent: "Molten Core" }, "gets new mechanics, plus 3 boss teases"],
    takeaway: "Molten Core will not be the raid you solved in 2004. Expect to relearn fights.",
    panelTitle: "From the podcast",
    panel: [
      { value: "Barrow Deeps", label: "Manage a damage buff that has a cost", words: true },
      { value: "Spider pair", label: "Nuthals is “super excited for” them", words: true },
      { value: "Hyjal Summit", label: "Undead crocolisk, two phases", words: true },
      { value: "Later", label: "Barrow Deeps and Hyjal, not at launch", words: true },
    ],
    source: "per the WoW: Forever Podcast",
  },
  {
    slug: "wow-forever-racial-changes-character-creation",
    tag: "Racials",
    date: "2026-10-27",
    headline: ["Dwarves get hit,", { accent: "Tauren run faster" }],
    takeaway: "Blizzard's final racial pass changes five races as character creation opens.",
    panelTitle: "Racial changes",
    panel: [
      { value: "1%", label: "Human crit, was 2%" },
      { value: "1%", label: "Dwarf hit, Artisan's Precision" },
      { value: "60%", label: "Tauren Plainsrunning, was 30%" },
      { value: "+5%", label: "Orc Command, Warlock and Hunter pet damage" },
      { value: "1 hr", label: "Skyborne buff at Ley Lines" },
    ],
    source: "per Blizzard's development notes",
  },
  {
    slug: "wow-forever-restricted-name-bug-fix",
    tag: "Names",
    date: "2026-10-28",
    headline: ["Rejected names", { accent: "get a retry" }],
    takeaway: "A bug made the restricted-name check far too strict. The fix goes in with each region's next realm restart.",
    panelTitle: "Name check bug",
    panel: [
      { value: "“con”", label: "Names containing it were blocked" },
      { value: "Next restart", label: "When the fix ships, in each region", words: true },
      { value: "Retry", label: "Any name told it is restricted", words: true },
      { value: "3", label: "Character slots, shared across rulesets" },
    ],
    source: "per Blizzard",
  },
  {
    slug: "wow-forever-two-part-names-explained",
    tag: "Names",
    date: "2026-10-29",
    headline: ["Names now have", { accent: "two parts" }],
    takeaway: "A first name and a second name. Only the full pair has to be unique in your region.",
    panelTitle: "How it works",
    panel: [
      { value: "First + second", label: "Two names per character", words: true },
      { value: "Region", label: "Where the full pair must be unique", words: true },
      { value: "Oct 27–Nov 3", label: "Early name reservations" },
      { value: "3", label: "Characters total, all rulesets" },
    ],
    source: "per Blizzard",
  },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-30" as "Oct 30, 2026", as the card prints it. */
export const shortDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const headlineText = (parts) => parts.map((p) => (typeof p === "string" ? p : p.accent)).join(" ");

/** The alt text: everything the card says, in reading order. */
export function altText(card) {
  const rows = card.panel.map((r) => `${r.value}: ${r.label}`.replace(/[“”]/g, '"')).join("; ");
  return `Everloot card: ${card.tag}, ${shortDate(card.date)}. ${headlineText(card.headline)}. ${card.takeaway} ${card.panelTitle}: ${rows}. Footer: ${card.source}, fan recap, not affiliated, everloot.app.`;
}
