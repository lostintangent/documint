# Component Overlays

The overlays subsystem renders Documint's floating editor UI so users get contextual controls where the work is happening instead of relying on a global toolbar. It is Documint's custom DOM design system for editor chrome, built around leaves and anchors that can follow document content, stay fixed to the editor viewport, and overlap the host page.

## Design Notes

- **Document anchors turn hook intent into scroll-aware placement.** Hooks and overlay sprigs (read-only component-store slices local to overlay UI) emit `DocumentAnchorTarget` shapes that say "render this leaf at this editor point." `Documint` resolves the target against prepared layout and visible viewport policy. `DocumentAnchor` handles portaled placement, horizontal clamping, above/below flipping, and hover bridges without the hook owning positioning.
- **Viewport anchors keep fixed chrome aligned to the editor.** Document leaves extend `DocumentAnchorTarget`. Fixed leaves such as search and presence use `ViewportAnchor` instead. It mirrors an in-place sticky sentinel into the portal, follows the editor viewport instead of a document point, and still shares the same leaf shell and theme path as document-anchored leaves.
- **One document-leaf arbitration path prevents competing chrome.** Document leaves use completion, pointer, selection, then cursor priority. New document-contextual UI should add a leaf type/view model, emit it from the owning hook or overlay sprig, and join `Documint`'s single active-leaf switch instead of creating a parallel placement path. `leaves/sprigs.ts` keeps those overlay-specific view models next to the UI so the core store does not learn leaf vocabulary.
- **Portals let editor chrome overlap without inheriting host CSS.** `OverlayPortal` mounts a shadow root under `document.body`, so leaves can intersect the editor, escape host clipping and stacking contexts, and still receive the editor theme through CSS variables on the portaled wrapper.
- **Leaf UI owns chrome while commands stay outside.** Leaf components render forms, buttons, markdown snippets, local focus behavior, and browser affordances, but editing commands and host callbacks are passed in by `Documint` or component hooks. Overlays render the surface. Component and editor layers own the behavior behind it. Shared dismissal, focus return, and active-item behavior belong in overlay primitives or owning feature hooks, not editor or renderer code.
- **Shared leaf primitives keep chrome consistent.** Shared controls, inputs, markdown fragments, completion popovers, dividers, and portal CSS give every concrete leaf the same toolbar, form, icon, spacing, animation, and token language. Tailwind utilities and Lucide icons are materials, not the component model. Portal CSS owns shadow-root tokens, animation infrastructure, and shell behavior. Concrete leaves own content composition.

## Subsystem Map

- `leaves/` owns leaf vocabulary, overlay-owned sprigs, shared design-system primitives, and concrete leaves for insertion, tables, links, annotations, search, and completions.
- `leaves/core/shared.ts` owns the conceptual leaf contract: `DocumentAnchorTarget`, `DocumentAnchorResolution`, leaf kinds, and contextual leaf resolution.
- `anchors/` owns the document-anchor and viewport-anchor placement shells plus the viewport fitting helpers they share.
- `OverlayPortal.tsx` owns the shadow-root portal, overlay stylesheet injection, and theme-variable bridge for all portaled overlay UI.
- `PresenceIndicator.tsx` owns the compact presence pills rendered by `ViewportAnchor`.
- `styles.css` and `generated.css` own the portal CSS source and generated fallback injected into the shadow root.
