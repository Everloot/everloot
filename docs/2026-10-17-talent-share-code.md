# Talent share code, version 1 (2026-10-17)

For the web talent calculator and the addon (`addon/modules/plan.lua`). Both write and read this
format, so a plan made on the site can be loaded in game with `/everloot plan <code>`, and the
addon's `/everloot talents` prints a code the site can open.

    EL1-<class>-<spec>-<build>-<payload>

- `EL1`: format version. Bump it for any change a version 1 reader would misread. A reader refuses
  versions it does not know.
- `class`: lowercase class token (`mage`, `druid`, `hunter`, `paladin`, `priest`, `rogue`, `shaman`,
  `warlock`, `warrior`).
- `spec`: the client's spec id for the class, or `0`. Forever has one spec id per class. The builders
  study reads them from Blizzard's UI files as 1482 and 1484 to 1491 (nine ids, 1483 unused); that is
  pending `/everloot selftest`, so do not hard-code the table yet. The site may write `0`. A reader that
  knows both its own spec id and the plan's warns when they differ.
- `build`: the client build the plan was made on (`1.60.1.70450`). It makes a stale link visible: node
  ids can move between builds, so a reader on another build shows a warning instead of silently
  applying the plan. The site can use it to show what changed since.
- `payload`: base64url, RFC 4648 section 5 alphabet, no `=` padding, of the ASCII text
  `node:rank,node:rank:choice,...`.
  - `node`: the client's trait node id, never a row or column position.
  - `rank`: the target rank, 1 to 50.
  - `choice`: optional, the zero-based entry of a choice node (the same index Blizzard's loadout
    string uses).
  - The site writes items in numerically ascending node id order, and a reader accepts any order.
    Item order is not a spend order, although addon 0.3.12 still names its next point to spend from
    it; see "Spend order" below. A node that is not listed is planned at zero. At most 600 items,
    and a node id may appear only once (a reader rejects duplicates). Trailing `=` padding is
    ignored on read but never written.
- `build` is digits in dot-separated groups with at least two groups, the same shape as the upload
  `clientBuild`.

The separator is `-`, which also appears in base64url, so split on the first four `-` only: class has
letters, spec has digits and build has digits and dots, so none of them contains one.

Example: `EL1-mage-1482-1.60.1.70450-OTAwMDE6Miw5MDAwMjoxOjEsOTAwMDQ6Mg` is
`90001:2,90002:1:1,90004:2`, a Mage plan for build 1.60.1.70450.

## Sharing in a URL

Put the code in the fragment, for example `/tools/talents/mage#plan=EL1-...`. A fragment never
reaches the server, so a shared build stays private, and it still opens in the browser.

## Spend order (2026-10-26)

A plan can carry the order its points are spent in. The order is a token of its own next to the
code, never part of it, so every EL1 code, link and addon example stays byte for byte what it was.
A code without an order token has no known spend order: a reader treats the order as unknown and
must not derive one from item order or node ids.

    O1<mode>-<sequence>

- `O1`: order format version, in digits with no leading zero. Bump it for any change a version 1
  reader would misread, a new mode included. `O2` and later are newer than a version 1 reader,
  whatever follows the number; `O0` and `O01` are malformed.
- `mode`: one lowercase letter saying who made the order. It is read from the token only, never
  from how the plan arrived (a link, a paste, a saved build or the addon).
  - `p`, planned: the player planned it.
  - `g`, provisional: a tool generated it.

  Version 1 defines only these two: any other lowercase letter is an unsupported mode. Anything else
  in that place (an uppercase letter, two letters, no letter) makes the token malformed; a digit
  there is part of the version number.
- `sequence`: one or more characters, one per point, in spend order. Each character is a node's
  index among the code's nodes that have points, sorted by numerically ascending node id (9 before
  10), written in the base64url alphabet of RFC 4648 section 5 (`A` is 0, `_` is 63). The order of
  the payload's items never changes an index. Each node appears exactly as many times as its rank
  in the code.
- At most 64 points, and so at most 64 nodes: one character per point from a 64-character alphabet.
  That is a limit of the token, not a game rule. A plan with more points gets no order token.

Example: in the mage code above (`90001:2,90002:1:1,90004:2`), 90001 is `A`, 90002 is `B` and 90004
is `C`. `O1p-AABCC` is the player's order: both points in 90001, then 90002, then 90004 twice.

A reader checks the token against the code it came with:

| Token | Error |
|---|---|
| not `O`, a version, a mode letter, `-` and a sequence as above | `malformed` |
| a version above 1 | `newer-version` |
| a lowercase mode letter other than `p` or `g` | `unsupported-mode` |
| more than 64 characters, or a code with more than 64 points | `over-limit` |
| a node more often than its rank, or an index past the code's nodes | `extra-points` |
| a node less often than its rank | `missing-points` |

Whitespace before or after the token is ignored. Whitespace inside it damages its shape, so the
token is `malformed`, unless it starts with a version above 1, which is `newer-version` whatever
follows (see the order of errors below). Whitespace means exactly the code points that ECMAScript's
`String.prototype.trim` removes (ECMA-262's WhiteSpace and LineTerminator, with the space separators
of Unicode 18.0): U+0009 to U+000D, U+0020, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029,
U+202F, U+205F, U+3000 and U+FEFF. A reader in another language trims this set rather than its own
default, matching the UTF-8 forms if it reads bytes.

A token with more than one of the problems in the table gets one error, the first that applies in
this order: a version above 1 is `newer-version` whatever follows it; then a damaged shape is
`malformed`, even with an unsupported mode or over the limit; then `unsupported-mode`, even over the
limit; then `over-limit`; then `extra-points` before `missing-points`.

Whatever the error, the talents load exactly as they would without the order, and the order is
unknown. The web importer (`importCode`) also calls the order unknown when not every point of the
code places on the tree on screen, because the order names points the build no longer holds.

A known order only means the token's points match the talents that loaded. Whether each point could
be spent at its place in the order (row gates, prerequisites, the level each point arrives at) is a
separate check against the tree's rules, and reading the token does not make it. The calculator makes
that check when it opens a plan (`importPlan`): an order that passes opens with its own label, and one
that does not opens the talents with the order unknown and says where it broke. A token it cannot use
stays in its links, as it came, until that set changes. New points join the order as planned; an
order is generated, and labelled provisional, only when the player asks for one.

### Orders in a link

Each set's order rides after both codes: the first set's after `&order=`, the second's after
`&order2=`.

    /tools/talents/mage#plan=EL1-...&plan2=EL1-...&order=O1p-...&order2=O1g-...

The codes keep their places, and a reader that stops at `&` ignores the orders: the site before
orders still reads both sets, and the addon still reads the one set it always read (the first set,
or the second when the link carries only that one). An order is left out when its set has no code.
A link without orders is the same address as before.

The calculator's Copy for addon gives one set as a full class page link with only that set's own
pair: `#plan=<code>&order=<token>` for the first set, `#plan2=<code>&order2=<token>` for the second.
Its build link keeps the codes in the path, where a link preview can name the build, and carries
their orders in the fragment: `/tools/talents/mage/b/EL1-.../EL1-...#order=O1p-...&order2=O1g-...`.
Opened, it moves to the class page address above.

Reading a link is literal: the site's `readPlanHash` returns each of the four keys it finds, so a
hand-edited link such as `#plan2=...&order=...` gives a first set's order with no first set's code.
That order has nothing to order; use an order only with its own set's code.

### Test vectors

[`fixtures/talent-order-v1.json`](fixtures/talent-order-v1.json) holds the cases above as data:
tokens written for given ranks and orders, tokens read back with their order or error, and links read
and written. A reader or writer of the token should pass all of them; the site runs them in
`web/src/lib/talents/order-vectors.test.ts`.

## Not this format

Blizzard's loadout string (`C_Traits.GenerateImportString`) is a different thing: a bit-packed string
that breaks on any version or tree change. It stays an import and export adapter. The addon stores it
next to a snapshot (`loadoutString`, `exportStatus`) so the site can test its decoder against real
strings. See the builders study in the project wiki, section 3.

## Open until the beta session

- Forever's real spec ids and node order come from `/everloot selftest` (the addon only checks them).
- Whether the game accepts an imported loadout is not tested by the addon. It never calls
  `ImportLoadout`.
