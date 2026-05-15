# Editor Text

This subsystem owns pure text semantics that are shared across editor
subsystems. A helper belongs here only when multiple subsystems need the same
meaning; text-related logic that has a single owner should stay with that
owner.

Keep browser and canvas side effects out of this folder. Canvas contexts,
font metrics, render caches, and pixel placement stay in `canvas` or `layout`.

### Key Areas

- `graphemes.ts` - Owns user-visible text boundaries. Layout uses it to measure
  fallback boundaries and map Pretext cursors back to editor UTF-16 offsets;
  navigation uses it for left/right caret movement; and state uses it for
  deletion so all text-coordinate movement agrees on the same character model.

- `words.ts` - Owns word-boundary expansion for text selection. Layout hit
  testing maps pointer coordinates to an editor offset, then asks this module
  for the word range so geometry stays separate from text segmentation policy.

- `fonts.ts` - Owns pure font-string resolution from document marks and code
  text policy. Layout uses
  it before measurement and canvas uses it before painting, keeping measured and
  rendered text styles in sync without moving canvas metrics or paint policy
  into this subsystem.

- `emoji.ts` - Owns color-emoji detection for editor text effects that need to
  avoid color glyph rendering limitations. Layout relies on Pretext for
  emoji-aware measurement and wrapping.

- `decorations.ts` - Owns editor-level text decoration indexing by region path.
  Component/worker code resolves semantic decoration matches; this module keeps
  those text ranges reconciled with the current editor document index for paint.

### Boundaries

Avoid moving layout measurement, paint policy, DOM event handling, anchor
resolution, or canvas font metrics here just because those files deal with
text. Those concerns stay with their owning subsystem until they become shared
editor text semantics.
