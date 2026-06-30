# Component Completions

The completions subsystem powers Documint's `@` mention and `:` emoji autocomplete, so users can mention host-provided people and insert built-in emoji while typing in the document or overlay text inputs. Its central model is `CompletionSource`: a trigger plus candidate items that document completions and overlay text inputs can share.

## Design Notes

- **CompletionSource is the host-edge contract.** A `CompletionSource` is just a trigger plus candidate items. `Documint` builds sources from host users and the built-in emoji catalog. Document completions, overlay textarea completions, mention extraction, and comment mention rendering share that roster shape without learning each other's UI or editor state.
- **Pure text rules run before UI adapters.** `completions.ts` owns trigger detection, match filtering, insertion text, and committed-token scanning. These functions know about space/newline/tab trigger boundaries, case-insensitive active filtering, longest committed token matches, and match limits, but not DOM anchors, overlays, React state, or editor commands.
- **Document completions are path-local and command-aware.** `document-completions.ts` projects the collapsed editor caret into the focused text path, then describes accepted items as either atomic mention applications or plain text replacements. `useDocumentCompletions` executes the editor commands and reports accepted mentions through an injected callback. Sync owns host-facing mention-event payloads. Leaf-input mention completions stay plain textarea text insertion.
- **One keyboard controller serves every completion surface.** `useCompletions` owns active-row state, dismissal, accepted-context suppression, arrow navigation, Enter/Tab acceptance, Escape dismissal, and native `beforeinput` quirks. Document completions and leaf inputs reuse that controller instead of duplicating mobile keyboard and stale-context handling.
- **Completion hooks produce intent, not pixels.** `documentCompletionSprig` publishes the active document context, and `useDocumentCompletions` returns a `CompletionLeaf` target. `Documint` builds source lists, gates editability, wires key handlers, arbitrates leaf priority, and resolves the document anchor before overlays render the portaled surface. Overlay textarea completions reuse the same keyboard controller, but their DOM anchoring stays in overlay input code.

## Subsystem Map

- `completions.ts` owns the shared completion types, trigger detection, filtering, insertion text, source equality, and committed trigger tokenization.
- `document-completions.ts` owns the adapter from editor caret context to document completion applications.
- `useCompletions.ts` owns shared keyboard, dismissal, acceptance, and `beforeinput` behavior for active completion lists.
- `useDocumentCompletions.ts` owns the React adapter from document completions to editor commands, accepted-mention reports, and overlay leaf targets.
- `sources/` owns built-in emoji data and host-user mention source construction.
