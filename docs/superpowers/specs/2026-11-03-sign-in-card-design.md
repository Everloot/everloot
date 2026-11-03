# Sign-in card — design (2026-11-03)

## Intent

The sign-in and sign-up pages become one centred card: a row of provider tiles, then email, then the links. The
reference is the compact card most developer tools use (mark on top, square provider tiles, "or use email", sign-up
and legal links under the card). The owner asked for Google, GitHub, Twitch, Battle.net "and any other possible one".

## What exists

- Production shows one method: "Sign in with Battle.net", in a two-column panel with the home art on the left.
- Google, Microsoft, Twitch, Discord and email sign-in are built and tested but hidden behind `EVERLOOT_AUTH_V2`,
  which stays off until its post-launch prerequisites (auth role password, Hyperdrive) are done.
- GitHub was not wired. Better Auth ships it; it needs an OAuth App and the two env values.

## Goals

- One card that reads the same with one provider (today) and six (after AUTH_V2).
- Each provider's mark shown the way its owner allows.
- No change to flags, secrets, flows or the account page's link controls.

## Non-goals

- Turning any provider on. A merge changes the look, not what a visitor can sign in with.
- A light theme. The site is dark-only.

## Constraints from the providers' rules (read 2026-11-03)

- **Google:** the icon-only "G" is allowed inside a button boundary; the dark spec is a #131314 fill with a 1 px
  #8E918F stroke, and the square shape is in the pre-approved set. The tile uses exactly that.
- **Microsoft:** the logo must appear with "Sign in with Microsoft" (or the short "Sign in"). No icon mode, so it
  keeps its full-width text button under the tile row.
- **GitHub:** the Invertocat in white or black only, unaltered, on a plain high-contrast background. The sign-in use
  itself is not spelled out on the brand page; the mark is the Octicons drawing (MIT) and is recorded in
  THIRD_PARTY.md. Owner to confirm he is comfortable with it.
- **Battle.net:** Blizzard publishes no logo licence, so it stays a text button, full width, first.
- **Twitch, Discord:** marks from their kits, unaltered, already in the repo.

## Approaches considered

1. **Tiles for every provider, Microsoft included.** Cleanest row; breaks Microsoft's rule. Rejected.
2. **Keep the full-width text buttons, only restyle the frame.** Honest but not what was asked for. Rejected.
3. **Tiles for the providers that allow an icon mode, text buttons for the two that do not (chosen).** Battle.net
   on top, the tile row, Microsoft under it when configured, then email.

## Decisions

- `SocialSignIn` gets a `layout` prop: `tiles` on the two auth pages, `list` (unchanged) on the account page.
- `AuthShell` becomes the centred card: Glint and the site line over the home art (masked, half opacity), the card,
  the page's own footer lines, then a Legal row (Terms, Privacy, Security) and the art credit.
- Provider order in `SOCIAL_PROVIDERS` is the tile order: Google, GitHub, Discord, Twitch, Microsoft.
- Tiles are 48 px tall, Everloot's `rounded-control` border, the mark at 24 px (Google's G at 20 px per its spec),
  `aria-label` and `title` carry the provider's name.

## Left to the builder

- Nothing structural. Follow-ups: a GitHub OAuth App and its secrets on the Worker (owner), and the AUTH_V2
  prerequisites before any tile beyond Battle.net shows in production.
