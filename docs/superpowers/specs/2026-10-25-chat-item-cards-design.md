# Item details inside Chat

Status: proposed for design approval, 2026-10-25.

## Intent

An item question such as "Where does Linen Cloth drop?" should identify the item and show useful Everloot database information inside Chat. Carlos selected an item card, known drops and a database link.

## Approaches

- Selected: show a database-backed card inside Chat, reusing the site's existing item lookup and card routes. This keeps the answer useful without a model key and preserves the publishing rules.
- Alternative: link to the item page and rely on its hover card. Smaller, but makes the player leave the conversation to see drops.
- Rejected: add names and private tooltip facts to a new public API or model tool. This would broaden the existing data publishing policy unnecessarily.

## Proposed behavior

- Resolve item names through the existing page-side item suggestions. Prefer an exact name match; never silently substitute a similar item. Ambiguous results offer item choices.
- Show the existing item card's name, icon, quality, available tooltip lines and provenance. Link to the canonical `/database/items/<id>` page.
- Fetch drop information through the existing player-data item tool. Show only sources it publishes, with the available sample counts and evidence. A reported rate is an observed sample, not a guaranteed game drop rate.
- Distinguish no published drops, insufficient reports and temporarily unavailable data. Never turn an outage into "this item does not drop" or borrow archived wiki drops as confirmed Forever data.
- Work with and without a model key. Keep page-only card facts out of provider prompts and tool output; the model continues to receive only the data current public tools allow.
- Save only the item reference with the conversation and refresh its card data when displayed, rather than storing a permanent copy of changing drop facts. Existing conversations remain readable.

## Constraints and non-goals

Reuse the current Chat layout, game card presentation and existing same-origin routes. Preserve protected-page CSP, per-tab provider keys, publishing gates and source labels. No new service, analytics collection, raw question logging, bulk exports, invented drop locations or database page redesign.

## Verification

Test exact Linen Cloth resolution against similar names, ambiguous choices, no-key answers, provider-backed answers, missing or unavailable drops, old conversations and the publishing boundary. Check real desktop and narrow-screen Chat rendering, item links, provenance and protected-page behavior. Run relevant existing tests, types, lint and production build before release.

## Builder decisions

The implementation may choose the smallest matching and rendering helpers consistent with these behaviors. If existing routes cannot support a field within the publishing rules, omit that field rather than widen the rules. No dependency, environment or deployment configuration changes are planned.
