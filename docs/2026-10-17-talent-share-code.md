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
  - Items are in spend order, which is what "next point to spend" follows. A node that is not listed
    is planned at zero. At most 600 items, and a node id may appear only once (a reader rejects
    duplicates). Trailing `=` padding is ignored on read but never written.
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

    O1<mode>-<sequence>

- `O1`: order format version. Bump it for any change a version 1 reader would misread, a new mode
  included. `O2` and later are newer than a version 1 reader; `O0` and `O01` are damaged.
- `mode`: who made the order. It is read from the token only, never from how the plan arrived (a
  link, a paste, a saved build or the addon).
  - `p`, planned: the player planned it.
  - `g`, provisional: a tool generated it.

  Version 1 has only these two. Any other letter is an unsupported mode.
- `sequence`: one character per point, in spend order. Each character is a node's index among the
  code's nodes that have points, sorted by ascending node id, written in the base64url alphabet of
  RFC 4648 section 5 (`A` is 0, `_` is 63). The order of the payload's items never changes an
  index. Each node appears exactly as many times as its rank in the code.
- At most 64 points, and so at most 64 nodes: one character per point from a 64-character alphabet.
  That is a limit of the token, not a game rule. A plan with more points gets no order token.

Example: in the mage code above (`90001:2,90002:1:1,90004:2`), 90001 is `A`, 90002 is `B` and 90004
is `C`. `O1p-AABCC` is the player's order: both points in 90001, then 90002, then 90004 twice.

A reader checks the token against the code it came with:

| Token | Error |
|---|---|
| not `O<version><mode>-<sequence>` in base64url | `malformed` |
| a version above 1 | `newer-version` |
| a mode other than `p` or `g` | `unsupported-mode` |
| more than 64 characters, or a code with more than 64 points | `over-limit` |
| a node more often than its rank, or an index past the code's nodes | `extra-points` |
| a node less often than its rank | `missing-points` |

Whatever the error, the talents load as the code has them and the order is unknown. The site also
calls the order unknown when not every point of the code places on the tree on screen, because the
order names points the build no longer holds.

### Orders in a link

Each set's order rides after both codes: the first set's after `&order=`, the second's after
`&order2=`.

    /tools/talents/mage#plan=EL1-...&plan2=EL1-...&order=O1p-...&order2=O1g-...

The codes keep their places, so a reader that stops at `&` (the addon, and the site before orders)
reads both sets as before and ignores the orders. An order is left out when its set has no code. A
link without orders is the same address as before.

## Not this format

Blizzard's loadout string (`C_Traits.GenerateImportString`) is a different thing: a bit-packed string
that breaks on any version or tree change. It stays an import and export adapter. The addon stores it
next to a snapshot (`loadoutString`, `exportStatus`) so the site can test its decoder against real
strings. See the builders study in the project wiki, section 3.

## Open until the beta session

- Forever's real spec ids and node order come from `/everloot selftest` (the addon only checks them).
- Whether the game accepts an imported loadout is not tested by the addon. It never calls
  `ImportLoadout`.
