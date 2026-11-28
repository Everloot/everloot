# Client recipe outputs: source and coverage receipt

Generated data: `web/src/data/game-data/client-recipes.json` (`everloot.client-recipes/1`, fields `outputs` and
`outputSource` added without a schema bump). Generator: `kb/src/client-recipes.ts` (`recipeOutputs`). Labelled
"found in game files, unconfirmed", like the rest of the file.

## Source

| | |
|---|---|
| Product and build | `wowf` 1.60.1.71139, buildConfig `7a16decda3672d84db0d34d0784fda98` |
| Snapshot | `wowf-71139-7a16decd.sqlite`, SHA-256 `933e9c3d8f8b1678cf8195f5bfce3ef53eae13fc7125d4706cf2b6520fdba38d` (matches its manifest; the generator refuses a mismatch) |
| Extractor and layouts | `@rhyster/wow-casc-dbc@2.16.21`, WoWDBDefs `8308f39154b5` |
| Extracted | 2026-11-27T09:24:37.822Z (the file's `build.extractedAt`) |
| Encrypted blocks not read | `SpellEffect` 14, `SpellCooldowns` 9 |
| Command | `npm run kb -- client-recipes <snapshot.sqlite> --out ../web/src/data/game-data/client-recipes.json` from `kb/` |

The snapshot was already owned for this build; nothing was downloaded or extracted for this change, and no table was
added to the read set. Running the command twice gives byte-identical output. The recipe tuples are unchanged from the
previous file of the same build; only `build.extractedAt` moved, to this snapshot's.

## Layout read

This build's `SpellEffect` layout has `EffectBasePointsF` and `Variance` and no legacy `EffectDieSides` or
`EffectBasePoints` columns. All 3,338 create-item rows (Effect 24 with an item) are at DifficultyID 0. Columns read:
`SpellID`, `DifficultyID`, `Effect`, `EffectIndex`, `EffectItemType`, `EffectBasePointsF`, `Variance`,
`EffectRealPointsPerLevel`, `EffectPointsPerResource`, `EffectBonusCoefficient` (required, and checked by the coverage
report through `NEEDED_FIELDS`), plus `EffectDieSides`, `EffectBasePoints`, `BonusCoefficientFromAP`, `Coefficient`,
`ResourceCoefficient` and `ScalingClass` when a layout has them, and `SpellCooldowns.RecoveryTime` and
`CategoryRecoveryTime`.

## Rule

- An entry needs exactly one base-difficulty create-item effect on the spell, for the item the recipe row names. Other
  effects on the spell are not read (Mooncloth 18560 has a second, unrelated effect).
- `minimum` = `maximum` = `EffectBasePointsF` only when it is a positive whole number, `Variance` and the per-level,
  per-resource and bonus coefficients are 0, any die sides or other scaling column is absent or 0, and any legacy base
  points agree. Otherwise both are null: unavailable, never 1. Zero is not read as one.
- `cooldownMs`: the larger of `RecoveryTime` and `CategoryRecoveryTime` at DifficultyID 0, when positive, the same rule
  as `scripts/build-recipe-cooldowns.py`. Null means none recorded in these files, not proof there is none.

## Coverage (2,310 item-making recipes)

| Reason | Recipes |
|---|---:|
| fixed | 2,207 |
| random (Variance) | 9 |
| nonPositive (`EffectBasePointsF` 0) | 94 |
| scaled, missing, nonIntegral, conflicting, ambiguous, noBaseEffect | 0 each |

103 entries have a null range. Fixed quantities: 1 (2,111), 2 (32), 5 (28), 3 (23), 200 (8), 4 (4), 100 (1).
15 entries have a cooldown; each equals the `limited` value in `addon/modules/recipe_cooldown_data.lua` (same
snapshot SHA-256; that file's 16th entry, 1302508, is not on a profession line this file lists). A test checks both.

## Samples

| Spell | Output |
|---|---|
| 3920, 3930, 3947 (shot) | items 8067, 8068, 8069, 200 each |
| 2963, 2964, 3865 (bolts) | items 2996, 2997, 4339, 1 each |
| 7751 | item 6290, 1 |
| 18560 (Mooncloth) | item 14342, 1, cooldown 342,000,000 ms |
| 3931 (Coarse Dynamite) | item 4365, range null (`EffectBasePointsF` 2, `Variance` 1) |

## Limits

- Not checked in game: what a random-yield (`Variance`) or zero-quantity row actually makes. Both stay unavailable until
  a supported reading is shown.
- Server-side changes and the encrypted blocks above are not in the client files.
- The game-file `SellPrice` is not a verified vendor sale price, and nothing here uses it as one.
