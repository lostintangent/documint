# Editor Text

This subsystem owns pure text semantics that are shared across editor
subsystems. A helper belongs here only when multiple subsystems need the same
meaning; text-related logic that has a single owner should stay with that
owner.

Keep browser and canvas side effects out of this folder. Canvas contexts,
font metrics, render caches, and pixel placement stay in `canvas` or `layout`.

### Key Areas

- `graphemes.ts` - Owns user-visible text boundaries. Layout uses it to measure
  grapheme clusters, navigation uses it for left/right caret movement, and
  state uses it for deletion so all text-coordinate movement agrees on the same
  character model.

- `fonts.ts` - Owns pure font-string resolution from document marks. Layout uses
  it before measurement and canvas uses it before painting, keeping measured and
  rendered text styles in sync without moving canvas metrics or paint policy
  into this subsystem.

- `emoji.ts` - Owns color-emoji detection. Layout uses it to route emoji text
  through measured grapheme layout, and state animation uses it to skip text
  fade effects that color emoji renderers cannot interpolate cleanly.

### Boundaries

Avoid moving word-selection policy, layout measurement, paint policy, DOM event
handling, anchor resolution, or canvas font metrics here just because those
files deal with text. Those concerns stay with their owning subsystem until
they become shared editor text semantics.
