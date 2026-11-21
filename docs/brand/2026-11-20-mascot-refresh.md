# Everloot mascot refresh

Implementation: faithful illustrated companion based on Jovian's supplied reference.

## Direction

Carlos requested replacing the website crow with an adaptation of Jovian's
supplied character. He rejected the upright, symmetrical vector redraw and
confirmed that the mascot should stay closer to the original. The subsequent
outline and fin refinements did not resolve that mismatch.

The current version preserves the original crouched three-quarter pose, long
arms, webbed hands and feet, asymmetrical oval golden eyes, large head, tall
tilted black hat, turquoise body, periwinkle fins, golden-orange spines, buck
tooth and painted shading. Brand changes are limited to a narrow green hat band
and a small emerald pin. No satchel, white sticker border or glow was added.

The original source is preserved as `jovian-mascot-reference.png`; its visible
checkerboard is not part of the new transparent illustrations. The diamond logo,
site palette, typography and page layouts remain unchanged. Glint remains the
provisional name; Carlos has not requested a replacement name.

## Assets

- `glint-mascot.png`: full-resolution transparent idle master for reuse.
- `glint-jovian-cheer.png`: matching delighted expression.
- `glint-jovian-sad.png`: matching disappointed expression for empty/404 states.
- `web/public/mascot/glint-{idle,cheer,sad}.webp`: website exports, each
  574 × 768 pixels, about 70 KB, with alpha transparency preserved.

The raster illustrations are the artwork source of truth. The rejected SVG
export has been removed. The original supplied reference is retained separately.

## Website behavior

The existing shared `Glint.tsx` now displays the appropriate local illustration
inside an SVG viewport with `preserveAspectRatio="xMidYMid meet"`. The whole
figure fits without cropping. Existing callers receive the new character on
the homepage, footer, authentication screens, chat welcome and 404 page.

Hovering the homepage mascot shows its cheerful expression and existing speech
feedback, then restores idle. The footer uses the cheerful expression while
its bubble is open. Keyboard/click speech controls, live-region announcements,
fixed layout dimensions and the existing pose/size/className API are retained.
An explicit item quality can recolor the small pin; the disappointed state
does not add an extra gem.

The artwork moves as a whole: a gentle breathing translation and a small greeting
bounce. Independent limb waves, eyelid blinking and gem sparkle were removed to
preserve the painted likeness. `still` and reduced-motion preferences disable
movement. Idle loops pause offscreen and while the document is hidden. Timers
and observers are cleaned up on unmount or when motion is disabled.

## Verification

Inspected actual component markup and CSS on the dark canvas at 48, 72, 88 and
176 pixels, including idle, cheer and sad expressions. All website exports have
alpha channels, fully transparent corner pixels and opaque character pixels.

Tests cover shipped image paths and format, containment without cropping,
meaningful/decorative labels, quality pin behavior, still-state cleanup,
hover expression/reset, speech rotation, focus pause, announcements and unmount
cleanup. Design guard, token checks and the game-art availability guard remain
in scope. The game-art guard now distinguishes the local mascot from assets
served by the separately configured game-art host.

Final full website suite: 561 files passed, 5 skipped; 6,370 tests passed,
30 skipped. Typecheck and lint pass (three existing warnings outside this change).
Whole-site navigation and live performance have not been measured. No deployment
is claimed.
