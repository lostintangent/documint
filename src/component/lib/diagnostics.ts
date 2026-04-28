import { useEffect, type RefObject } from "react";

/**
 * Lightweight runtime instrumentation for the editor.
 *
 * Diagnostic events are emitted by internal hooks (`useInput`,
 * `syncInputContext`, etc.) and rendered as a live log by the
 * playground's `DiagnosticsPopover` (which subscribes to the
 * {@link DIAGNOSTIC_EVENT} CustomEvent on `window`).
 *
 * Diagnostics are an internal dev tool, not part of the library's public
 * API — `DIAGNOSTIC_EVENT` and {@link Diagnostic} are not re-exported
 * from `src/index.ts`. The playground reaches in directly via the `@/`
 * tsconfig path alias.
 *
 * # Build-time gating
 *
 * Every diagnostic call site is gated by an inline
 * `process.env.NODE_ENV !== "production"` check. The expression is
 * substituted at build time so the bundler's minifier folds the gate
 * and dead-code-eliminates the entire branch (call, detail object
 * literal, every expression that builds it):
 *
 *   if (process.env.NODE_ENV !== "production") {
 *     emitDiagnostic("kind", { ...detail });
 *   }
 *   if (process.env.NODE_ENV !== "production") {
 *     useDiagnostics(inputRef);
 *   }
 *
 * Why the inline literal (rather than aliasing to a named constant): Bun's
 * minifier substitutes `process.env.NODE_ENV` at every textual occurrence,
 * but it doesn't reliably propagate a const-aliased value into use sites
 * inside exported function bodies — and our gates all live inside
 * exports. Inlining the literal at each gate site sidesteps that and
 * gives reliable DCE.
 *
 * In production the entire gated block is stripped — including the
 * `emitDiagnostic` call, the kind string, and the `detail` object
 * literal. The `emitDiagnostic` and `useDiagnostics` symbols themselves
 * tree-shake away because nothing references them.
 *
 * # Wiring
 *
 *   - The dev server (`bun run dev`) doesn't need extra setup; Bun's
 *     HTML bundler substitutes `process.env.NODE_ENV` with
 *     `"development"` automatically, so the gates evaluate to `true`.
 *   - `scripts/build.ts` passes `define: { "process.env.NODE_ENV":
 *     '"production"' }` to `Bun.build`, so every shipping build
 *     (publishable library, deployable playground demo) strips
 *     diagnostics.
 */

/** CustomEvent type the diagnostics subsystem dispatches. */
export const DIAGNOSTIC_EVENT = "documint:diagnostic";

/** Wire-format payload of a diagnostic event. */
export type Diagnostic = {
  kind: string;
  detail: Record<string, unknown>;
  ts: number;
};

/**
 * Emit a diagnostic event for any subscribed tool to render. Always wrap
 * call sites in `if (process.env.NODE_ENV !== "production")` so the
 * bundler can strip the call and its argument expressions in production.
 *
 * In environments without `window` (e.g. SSR, tests), falls back to
 * `console.log` so the diagnostic isn't silently dropped.
 */
export function emitDiagnostic(kind: string, detail: Record<string, unknown>) {
  if (typeof window === "undefined") {
    // eslint-disable-next-line no-console
    console.log(`[diag ${kind}]`, detail);
    return;
  }
  window.dispatchEvent(
    new CustomEvent<Diagnostic>(DIAGNOSTIC_EVENT, {
      detail: { kind, detail, ts: Date.now() },
    }),
  );
}

/**
 * Install diagnostic listeners that don't fit the inline-emit pattern at
 * call sites — namely, listeners on the input bridge and the document
 * itself, which exist independently of any single editor handler:
 *
 *   - **Composition events** (`compositionstart` / `compositionupdate` /
 *     `compositionend`) on the input textarea. Useful for observing IME
 *     and dictation behavior independent of `beforeinput` / `input`.
 *   - **Document `selectionchange`**. Fires regardless of whether React
 *     state propagation closes the loop, which is useful for diagnosing
 *     cases where the editor caret appears to move but no React
 *     re-render follows.
 *
 * Wrap the call to this hook in
 * `if (process.env.NODE_ENV !== "production")` like every other
 * diagnostic — in production the entire wrapping block (this hook call
 * and the two `useEffect` registrations it would make) is stripped.
 */
export function useDiagnostics(inputRef: RefObject<HTMLTextAreaElement | null>) {
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const log = (kind: string) => (event: Event) => {
      const ce = event as CompositionEvent;
      emitDiagnostic(kind, {
        data: ce.data,
        taValue: input.value,
        selectionStart: input.selectionStart,
        selectionEnd: input.selectionEnd,
      });
    };
    const onStart = log("compositionstart");
    const onUpdate = log("compositionupdate");
    const onEnd = log("compositionend");
    input.addEventListener("compositionstart", onStart);
    input.addEventListener("compositionupdate", onUpdate);
    input.addEventListener("compositionend", onEnd);
    return () => {
      input.removeEventListener("compositionstart", onStart);
      input.removeEventListener("compositionupdate", onUpdate);
      input.removeEventListener("compositionend", onEnd);
    };
  }, [inputRef]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onSelectionChange = () => {
      const input = inputRef.current;
      emitDiagnostic("selectionchange", {
        activeElementIsInput: document.activeElement === input,
        taSelectionStart: input?.selectionStart ?? null,
        taSelectionEnd: input?.selectionEnd ?? null,
      });
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [inputRef]);
}
