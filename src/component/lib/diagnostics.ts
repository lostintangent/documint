import { useEffect, type RefObject } from "react";
import type { DocumentFrame } from "@/renderer";

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
 * tsconfig path alias. Render-frame events follow the same dev-only path
 * and are consumed by playground-owned frame inspection.
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
 *   if (process.env.NODE_ENV !== "production") {
 *     recordFpsFrame(durationMs);
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
 * diagnostic call, the kind string, and the `detail` object literal.
 * The exported diagnostic helpers themselves tree-shake away because
 * nothing references them.
 *
 * # Wiring
 *
 *   - The dev server (`bun run dev`) doesn't need extra setup; Bun's
 *     HTML bundler substitutes `process.env.NODE_ENV` with
 *     `"development"` automatically, so the gates evaluate to `true`.
 *   - `scripts/build/build.ts` passes `define: { "process.env.NODE_ENV":
 *     '"production"' }` to `Bun.build`, so every shipping build
 *     (publishable library, deployable playground demo) strips
 *     diagnostics.
 */

/** CustomEvent type the diagnostics subsystem dispatches. */
export const DIAGNOSTIC_EVENT = "documint:diagnostic";
export const RENDER_FRAME_EVENT = "documint:render-frame";

/** Wire-format payload of a diagnostic event. */
export type Diagnostic = {
  /** Namespaced diagnostic kind, e.g. `documint:beforeinput`. */
  kind: string;
  detail: Record<string, unknown>;
  ts: number;
};

export type RenderFrameEvent = {
  canvas: HTMLCanvasElement;
  frame: DocumentFrame;
};

const DIAGNOSTIC_KIND_PREFIX = "documint:";
const FPS_SMOOTHING_ALPHA = 0.18;
const FPS_EMIT_INTERVAL_MS = 250;
const FPS_IDLE_RESET_MS = 1_250;
const FPS_MATERIAL_CHANGE = 3;
const DEFAULT_FRAME_BUDGET_FPS = 60;
const FRAME_BUDGET_SAMPLE_COUNT = 45;
const FRAME_BUDGET_BUCKETS = [30, 60, 90, 120, 144, 165, 240] as const;

let fpsLastEmitAt: number | null = null;
let fpsLastFrameAt: number | null = null;
let fpsLastRoundedValue: number | null = null;
let fpsSmoothedDurationMs: number | null = null;
let frameBudgetSampleDeltas: number[] | null = null;
let frameBudgetSampling = false;
let frameBudgetFps = DEFAULT_FRAME_BUDGET_FPS;
let frameBudgetReady = false;

/**
 * Emit a diagnostic event for any subscribed tool to render. Always wrap
 * call sites in `if (process.env.NODE_ENV !== "production")` so the
 * bundler can strip the call and its argument expressions in production.
 */
export function emitDiagnostic(kind: string, detail: Record<string, unknown>) {
  const namespacedKind = namespaceDiagnosticKind(kind);

  window.dispatchEvent(
    new CustomEvent<Diagnostic>(DIAGNOSTIC_EVENT, {
      detail: { kind: namespacedKind, detail, ts: Date.now() },
    }),
  );
}

export function emitRenderFrame(detail: RenderFrameEvent) {
  window.dispatchEvent(
    new CustomEvent<RenderFrameEvent>(RENDER_FRAME_EVENT, {
      detail,
    }),
  );
}

function namespaceDiagnosticKind(kind: string) {
  return kind.startsWith(DIAGNOSTIC_KIND_PREFIX) ? kind : `${DIAGNOSTIC_KIND_PREFIX}${kind}`;
}

/**
 * Record the cost of one completed scheduler frame for dev FPS
 * instrumentation. The emitted FPS is an estimated render capacity from
 * recent frame cost, capped to the active rAF cadence estimate so sparse
 * input streams don't look slow just because the browser requested fewer
 * frames.
 */
export function recordFpsFrame(durationMs: number) {
  const now = performance.now();
  if (fpsLastFrameAt !== null && now - fpsLastFrameAt > FPS_IDLE_RESET_MS) {
    resetFpsTracking();
  }
  fpsLastFrameAt = now;

  if (durationMs <= 0) {
    return;
  }

  fpsSmoothedDurationMs =
    fpsSmoothedDurationMs === null
      ? durationMs
      : fpsSmoothedDurationMs + FPS_SMOOTHING_ALPHA * (durationMs - fpsSmoothedDurationMs);

  const frameBudget = getFrameBudgetFps();
  const roundedValue = Math.round(Math.min(frameBudget, 1000 / fpsSmoothedDurationMs));
  const shouldEmit =
    fpsLastEmitAt === null ||
    now - fpsLastEmitAt >= FPS_EMIT_INTERVAL_MS ||
    fpsLastRoundedValue === null ||
    Math.abs(roundedValue - fpsLastRoundedValue) >= FPS_MATERIAL_CHANGE;

  if (!shouldEmit) {
    return;
  }

  fpsLastEmitAt = now;
  fpsLastRoundedValue = roundedValue;
  emitDiagnostic("fps", { cap: frameBudget, capPending: !frameBudgetReady, value: roundedValue });
}

function resetFpsTracking() {
  fpsLastEmitAt = null;
  fpsLastFrameAt = null;
  fpsLastRoundedValue = null;
  fpsSmoothedDurationMs = null;
}

function getFrameBudgetFps() {
  if (!frameBudgetSampling) {
    sampleFrameBudget();
  }
  return frameBudgetFps;
}

function sampleFrameBudget() {
  frameBudgetSampling = true;
  frameBudgetSampleDeltas = [];
  let lastTimestamp: number | null = null;

  const sample = (timestamp: number) => {
    if (lastTimestamp !== null && frameBudgetSampleDeltas !== null) {
      const deltaMs = timestamp - lastTimestamp;
      if (deltaMs > 0 && deltaMs < 100) {
        frameBudgetSampleDeltas.push(deltaMs);
      }
    }
    lastTimestamp = timestamp;

    if (
      frameBudgetSampleDeltas !== null &&
      frameBudgetSampleDeltas.length >= FRAME_BUDGET_SAMPLE_COUNT
    ) {
      frameBudgetFps = snapFrameBudgetFps(1000 / median(frameBudgetSampleDeltas));
      frameBudgetReady = true;
      frameBudgetSampleDeltas = null;
      return;
    }

    window.requestAnimationFrame(sample);
  };

  window.requestAnimationFrame(sample);
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 1000 / DEFAULT_FRAME_BUDGET_FPS;
}

function snapFrameBudgetFps(fps: number) {
  let nearest: number = FRAME_BUDGET_BUCKETS[0];
  let nearestDistance = Math.abs(fps - nearest);
  for (const bucket of FRAME_BUDGET_BUCKETS) {
    const distance = Math.abs(fps - bucket);
    if (distance < nearestDistance) {
      nearest = bucket;
      nearestDistance = distance;
    }
  }
  return nearest;
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
