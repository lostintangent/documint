// Documint's runtime stylesheet, assembled from three CSS files via Bun's
// text imports.
//
// Documint's CSS rules are an internal implementation detail. Embedders
// customize visuals through the `theme` prop (see EditorTheme), which sets
// CSS custom properties consumed by these rules. They are intentionally
// not wrapped in `:where()` or `@layer` — keeping the rules at natural
// specificity makes them resilient to common host-app CSS resets
// (`button { ... }`, `* { ... }`, etc.) without surprising contributors.
import editorCss from "./styles.css" with { type: "text" };
import leafCss from "./overlays/leaves/styles.css" with { type: "text" };
import toolbarCss from "./overlays/leaves/toolbar/styles.css" with { type: "text" };

export const DOCUMINT_EDITOR_STYLES = `${editorCss}\n${leafCss}\n${toolbarCss}`;
