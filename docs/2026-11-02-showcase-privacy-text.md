# /privacy: proposed text for linked characters and their public pages

Date: 2026-11-02. Status: **proposed, not live.** /privacy says nothing about character links today, because they are
off. This text goes into `web/src/app/privacy/page.tsx` in the go-live PR, in the same deploy that turns on
`EVERLOOT_CHARACTER_LINKS` and `EVERLOOT_SHOWCASE` ([checklist](2026-11-02-showcase-go-live.md)). It follows the
[policy draft](design/2026-11-01-public-character-policy-draft.md); `[D8]` is replaced by the answer to decision 3
on the [decision sheet](2026-11-02-showcase-decisions.md).

## 1. "Information we collect": a new item after "Profile"

> **Linked characters (optional):** on your account page you can link a character you play to your account. The
> site gives you a short code; you type it on the character with `/everloot link <code>`, and the Everloot Desktop
> App, signed in to your account, sends the row it writes. Link rows never go in an upload. We store the
> character's name, realm, race, class, faction and level, when it was linked and last sent, and two keyed one-way
> hashes: one of the game's id for the character, and one of your install id with the addon's key for the
> character. Neither the game's id nor the install id is stored. We store a code only as a hash; it works once, for
> 15 minutes. If our census rows for that character disagree on its race, class or faction, the link is refused. A
> link shows that someone with this account also had an addon file in which the character typed the code. We don't
> check it with Blizzard. If a second account links the same character, it is frozen on both and shown nowhere until
> we settle it: write to [D8]. A linked character is private: only you see it, unless you give it a public page.
>
> **Public character page (optional):** for each linked character you can turn on a public page at
> `/characters/<ruleset>/<realm>/<name>`. Anyone can open it and sees the character's name, level, race, class,
> faction and realm, the day it was last sent, and a share image drawn from the same fields. It never shows your
> BattleTag, your email, your account, your handle or the hashes. It says the details are self-reported and not
> checked against Blizzard. Search engines are asked not to index it. Turning the page off, unlinking the character
> or deleting your account removes the page and its images at once. A copy a link-preview service (Discord, X and
> others) has already fetched stays with that service. Anyone can hide a character on the
> hide form (`/players/opt-out`), without an account; a hidden character cannot be linked and has no public page.

## 2. "Your privacy choices": a new item after "Your profile"

> **Linked characters** are unlinked, and their public pages turned on or off, on your account page.

## 3. "How long we keep things": a new item after "Handle, display name, status and profile choices"

> **Linked characters and their page settings:** until you unlink the character or delete your account. Used and
> expired link codes are cleared when you make a new code a day or more later, and with your account.

## Notes for the go-live PR

- Add `{ id: "linked-characters" }` as the item's anchor, as `saved-builds` and `profiles` have.
- `web/src/app/privacy/privacy.test.tsx` gains a check that the paragraph names the hide form and never says
  "verified".
- If decision 2 (search engines) is ever yes, the sentence "Search engines are asked not to index it" changes in the
  same PR as the code.
