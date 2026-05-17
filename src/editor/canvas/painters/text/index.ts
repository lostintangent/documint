// Re-exports for the orchestrator. Internally the text painter splits
// into four files:
//   - runs.ts        — per-line styled text, inline-code chrome, image/mention
//                      dispatch (`paintLineText`)
//   - decorations.ts — host-supplied decoration index, painted in
//                      background and overlay phases (`paintTextDecorations`)
//   - effects.ts     — transient text effects: insert highlights, fades,
//                      pulses (`paintTextHighlights`,
//                      `paintTextFades`, `paintTextPulses`)
//   - glyphs.ts      — shared primitives all three call into
//                      (segment bounds, text background, clipped overlay)
//
// The orchestrator reaches for the four entry points re-exported here.
// glyphs.ts is internal to the text painter family.

export { paintLineText } from "./runs";
export { paintTextDecorations } from "./decorations";
export {
  paintTextFades,
  paintTextHighlights,
  paintTextPulses,
} from "./effects";
