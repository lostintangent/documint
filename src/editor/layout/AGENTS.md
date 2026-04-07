# Layout

This sub-system owns editor geometry. It turns `DocumentEditor` into exact line,
region, and block positions for a concrete slice of content, and it virtualizes
that work so large documents only pay exact layout cost for the visible
viewport window.

In practice, layout has two modes of work:

- exact local layout for the slice that is actually on screen
- cheap whole-document estimation so scrolling and viewport planning stay correct

## Layout input/output

Layout starts from `DocumentEditor`, not raw markdown or raw `Document`.

- `DocumentEditor`
  The runtime editing projection that exposes concrete editable regions,
  structural block ancestry, region text, runs, and table-cell metadata.

- `ViewportLayout`
  The exact geometry output for a concrete slice of regions:
  - `lines`
  - `regionExtents`
  - `regionLineIndices`
  - `blocks`
  - overall `height`

- `DocumentViewport`
  The viewport-oriented result that pairs:
  - exact `ViewportLayout` for the visible slice
  - estimated `totalHeight` for the whole document

## What triggers layout

Layout should be recomputed when geometry-affecting inputs change, especially:

- the `DocumentEditor` changes
  for example after edits, undo/redo, comment-anchor repair, or other semantic
  state changes that alter regions, runs, or block structure

- viewport inputs change
  for example scroll position, viewport height, or overscan

- layout options change
  for example width, padding, indent width, line height, or block gap

- document resources change
  especially image resource dimensions and load state, because those affect
  measured region height and viewport estimates

- text measurement policy changes
  for example heading typography or line-height rules that change measured text
  geometry

## Integration points

Layout geometry is used to:

- paint the visible canvas surface from prepared lines and extents

- resolve pointer targets, caret positions, and word selection against the
  prepared geometry

- drive vertical navigation, viewport movement, and table-aware caret behavior

- prepare host-facing editor layout and hit-testing results

- size the scroll surface correctly while rendering only the visible slice

## Responsibilities

- `document.ts`
  Owns exact local layout for a concrete region set. This file resolves line
  positions, region extents, block extents, caret targets, hit-test helpers,
  and the shared spacing policy that exact layout depends on.

- `viewport.ts`
  Owns viewport-aware layout orchestration. This file estimates whole-document
  height cheaply, chooses the visible region slice plus overscan, runs exact
  layout only for that slice, and shifts the result back into document
  coordinates.

- `text.ts`
  Owns text typography and measurement policy: fonts, line heights, wrapping,
  inline metric handling, and measured line boundaries.

- `table.ts`
  Owns exact table geometry, including row height harmonization across cells and
  table-specific region extents.

- `hit-test.ts`
  Owns pointer and caret targeting against prepared layout geometry.

## Design rules

- Keep exact layout policy in one place.
  If viewport estimation needs spacing or typography rules, import the owning
  helper from `document.ts` or `text.ts` instead of duplicating the policy in
  `viewport.ts`.

- Estimation may be approximate, but visible layout must be exact.
  `viewport.ts` exists to avoid full-document exact layout, not to weaken the
  correctness of what is on screen.

- Preserve estimate parity with exact layout.
  When changing block spacing, heading metrics, or other geometry policy, review
  both:
  - exact layout in `document.ts`
  - estimation/orchestration in `viewport.ts`

- Keep hot paths bounded.
  Large documents should still do:
  - cheap whole-document estimation
  - exact layout only for the viewport slice plus overscan
  - targeted cache invalidation keyed by the actual layout inputs

- Prefer semantic helpers over inline policy branches.
  If a spacing or typography rule becomes non-trivial, extract a small helper
  with a name that states the policy.

## Review checklist

- Does visible content still use exact layout rather than estimated geometry?
- Does any new spacing or typography policy stay shared between exact and
  estimated paths?
- Are cache keys updated if the new behavior changes measurement inputs?
- Does the playground still scroll to the true end of long documents?
- Do tables, images, and headings still resolve correct extents after the
  change?
