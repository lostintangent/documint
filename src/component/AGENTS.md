# Component

This sub-system owns the React host for the editor. Its job is to translate controlled markdown content and browser interactions/state into semantic editor calls, while keeping markdown semantics, editing behavior, layout policy, hit testing, and paint inside the lower-level subsystems.

The main responsibilities in this subsystem are:

- `content string <-> Document` bridging at the host boundary
- browser, DOM, and canvas host orchestration for `Documint`

### Key Files

- `Documint.tsx` - Owns the public `Documint` component, host lifecycle, DOM event wiring, viewport scheduling, and controlled-content bridging.

- `Ssr.tsx` - Owns the semantic SSR surface shown before the interactive canvas host mounts.

- `hooks/useEditor.ts` - Owns React lifetime for one editor instance.

- `hooks/useCursor.ts` - Owns caret presentation in the host: cursor visibility timing, activity tracking, and collapsed-caret leaf state for link and comment annotations.

- `hooks/useDocumentImages.ts` - Owns browser-side image discovery, loading, and caching for the current document.

- `hooks/useHover.ts` - Owns host-side hover resolution, cursor state, leaf state, and link-hover click behavior for the React host.

- `hooks/useNativeInput.ts` - Owns the hidden native input that adapts browser keyboard and IME behavior onto semantic editor operations, including mobile-specific input seeding for platform quirks.

- `hooks/useSelection.ts` - Owns selection-driven presentation in the host: DOM selection handles, handle dragging, and the selection leaf state that feeds the shared leaf precedence policy.

- `leaves/LeafPortal.tsx` - Owns the shared anchored leaf portal, shell chrome, and pointer-bridge policy used by comment and link leaf UI.

- `leaves/AnnotationLeaf.tsx` - Owns the DOM annotation leaf contents for selection formatting actions, comment creation, and thread interaction.

- `leaves/LinkLeaf.tsx` - Owns the DOM link leaf contents for displaying link destinations inside the shared leaf portal.

- `leaves/lib/leaf-target.ts` - Owns the shared mapping from editor target geometry into the contextual leaf payload used by both hover-driven and cursor-driven leaves.

- `hooks/useRenderScheduler.ts` - Owns animation-frame coalescing for document and cursor paints.

- `lib/selection.ts` - Owns host-side selection math, clipboard extraction, and drag auto-scroll helpers.

- `lib/metrics.ts` - Owns resize and host surface measurement helpers.

- `lib/canvas.ts` - Owns small canvas-host helpers such as device-pixel-ratio handling and observed-state equality.
