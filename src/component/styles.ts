// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./style-imports.d.ts" />

// Documint's runtime stylesheet, assembled from CSS files via Bun's
// text imports.
//
// Documint's CSS rules are an internal implementation detail. Embedders
// customize visuals through the `theme` prop (see EditorTheme), which sets
// CSS custom properties consumed by these rules. They are intentionally
// not wrapped in `:where()` or `@layer` — keeping the rules at natural
// specificity makes them resilient to common host-app CSS resets
// (`button { ... }`, `* { ... }`, etc.) without surprising contributors.
import editorCss from "./styles.css" with { type: "text" };
import generatedCss from "./generated.css" with { type: "text" };
import leafCss from "./overlays/leaves/styles.css" with { type: "text" };

export const DOCUMINT_EDITOR_STYLES = `${editorCss}\n${leafCss}`;

export const DOCUMINT_OVERLAY_PORTAL_STYLES = `
.documint-overlay {
  --tw-border-style: solid;
  --documint-leaf-shadow-fallback: 0 14px 40px
    color-mix(in srgb, var(--documint-leaf-text) 16%, transparent);
}

${generatedCss}
${leafCss}
`;
