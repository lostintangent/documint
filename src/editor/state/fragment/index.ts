// Fragment subsystem: capture a `Block[]` fragment from the current
// selection (extract), and apply a `Block[]` fragment back to a selection
// (apply). Bridges the structural editor model to the markdown clipboard
// format owned by `src/markdown/fragment.ts`.

export { extractFragment } from "./extract";
export { applyFragment } from "./apply";
