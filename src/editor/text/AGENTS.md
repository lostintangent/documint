# Editor Text

The text subsystem owns shared editor text semantics. A helper belongs here only when multiple editor subsystems need the same meaning; text-related logic with a single owner should stay with that owner.

Render caches and pixel placement stay in canvas or layout. Text measurement primitives live here only because both layout and canvas consume them; they may use browser canvas measurement internally, but the public surface should be font strings, text ranges, widths, and metrics rather than DOM or React concepts.

## Design Principles

- **Shared meaning lives here.** Move text logic into this subsystem only when multiple editor subsystems need to agree on it.
- **Single-owner policy stays put.** Do not move layout measurement policy, paint policy, DOM handling, or anchor resolution here just because the code touches text.
- **Coordinates must be explicit.** Be clear whether a helper works in UTF-16 offsets, grapheme steps, editor selection offsets, line-local ranges, or document/container offsets.
- **Runtime inline offsets are editor text semantics.** References occupy one object-replacement character in editor path text, links contribute the runtime length of their children, and line breaks occupy one newline. Document `plainText` can give the same inline nodes different semantic lengths for anchor matching, so conversion belongs at the editor anchor or index boundary.
- **Measurement and font policy are shared primitives.** `measure.ts` and `fonts.ts` keep layout measurement and canvas drawing aligned without owning placement or paint. Browser-backed measurement should stay behind those APIs.

## Subsystem Map

- `graphemes.ts` owns user-visible character boundaries.
- `words.ts` owns locale-aware word ranges and directional movement boundaries in UTF-16 editor offsets.
- `ranges.ts` owns shared overlap, containment, and clipping helpers.
- `fonts.ts` owns font-string resolution from marks, inline code, and text policy.
- `inline-offsets.ts` owns editor runtime inline text, inline lengths, and inline ranges in editor selection-offset space.
- `measure.ts` owns cached font metrics and text-width measurement.
- `emoji.ts` owns color-emoji detection for paint effects.
- `decorations.ts` owns editor-level text decoration indexing by editor path.
