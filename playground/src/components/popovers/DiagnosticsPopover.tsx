import { useEffect, useRef, useState } from "react";
import { Activity, Trash2 } from "lucide-react";
// Imported directly from the library's internal diagnostics module rather
// than from `documint`'s public API — diagnostics are dev-only tooling for
// the playground, not a stable public surface.
import { DIAGNOSTIC_EVENT, type Diagnostic } from "@/component/lib/diagnostics";
import {
  PlaygroundPopover,
  popoverHeaderClassName,
  popoverTitleClassName,
} from "./PlaygroundPopover";

// Most recent N diagnostic events to keep in memory. The popover is
// inspection-time tooling; older events are dropped silently.
const MAX_ENTRIES = 200;
const FPS_KIND = "documint:fps";
const FPS_STALE_CLEAR_MS = 1_250;
const FPS_HEALTHY_RATIO = 0.9;

type Entry = Diagnostic & { id: number };
type FpsReading = { cap: number; capPending: boolean; value: number };

/**
 * Live log of diagnostic events emitted by the editor (see
 * `src/component/lib/diagnostics.ts`). Renders as a popover next to the
 * playground header's other controls; each entry shows kind, time, and a
 * pretty-printed view of its detail payload.
 *
 * Only mounted in the dev playground — `Playground.tsx` gates the JSX
 * behind `process.env.NODE_ENV !== "production"`, so the deployable demo
 * (and any other production-shaped build) tree-shakes this component away.
 */
export function DiagnosticsPopover({
  frameDebugEnabled,
  onFrameDebugEnabledChange,
}: {
  frameDebugEnabled: boolean;
  onFrameDebugEnabledChange: (enabled: boolean) => void;
}) {
  const entries = useDiagnosticEntries();
  const listRef = useAutoScrollToBottom(entries.list);

  return (
    <PlaygroundPopover
      ariaLabel="Input diagnostics"
      flyoutClassName="font-code max-h-[min(70vh,36rem)] grid-rows-[auto_minmax(0,1fr)] text-[0.78rem] leading-[1.4] max-[700px]:portrait:max-h-[min(60vh,30rem)]"
      icon={<DiagnosticsIcon fps={entries.fps} />}
      size="lg"
      showSwatch={false}
    >
      <div className={popoverHeaderClassName}>
        <strong className={popoverTitleClassName}>
          Diagnostics
          {entries.list.length > 0 ? ` (${entries.list.length})` : ""}
        </strong>
        <div className="flex items-center">
          <label className="font-controls flex cursor-pointer items-center gap-2 text-[0.82rem] text-muted">
            <span>X-Ray</span>
            <input
              checked={frameDebugEnabled}
              onChange={(event) => onFrameDebugEnabledChange(event.target.checked)}
              type="checkbox"
            />
          </label>
          <span aria-hidden="true" className="mx-2 h-[1.5rem] w-px bg-border/[0.14]" />
          <button
            aria-label="Clear diagnostics"
            className="inline-flex h-[1.9rem] w-[1.9rem] items-center justify-center rounded-[0.55rem] border-0 bg-transparent p-0 text-muted transition-colors hover:text-foreground"
            onClick={entries.clear}
            title="Clear diagnostics"
            type="button"
          >
            <Trash2 aria-hidden="true" size={14} strokeWidth={2.1} />
          </button>
        </div>
      </div>
      <div className="grid min-h-0 content-start gap-[0.4rem] overflow-y-auto" ref={listRef}>
        {entries.list.length === 0 ? (
          <p className="font-controls m-0 p-2 text-[0.85rem] text-muted">
            Waiting for input events… (focus the editor and type / dictate / move the caret)
          </p>
        ) : (
          entries.list.map((entry) => <DiagnosticDetails diagnostic={entry} key={entry.id} />)
        )}
      </div>
    </PlaygroundPopover>
  );
}

function DiagnosticsIcon({ fps }: { fps: FpsReading | null }) {
  return fps === null ? <Activity size={16} strokeWidth={2.1} /> : <FpsIcon fps={fps} />;
}

function FpsIcon({ fps }: { fps: FpsReading }) {
  if (fps.capPending) {
    return <Activity size={16} strokeWidth={2.1} />;
  }

  const statusClassName =
    fps.value >= fps.cap * FPS_HEALTHY_RATIO
      ? "border-emerald-500/35 bg-emerald-50 text-emerald-700"
      : "border-red-500/35 bg-red-50 text-red-700";

  return (
    <span
      className={`font-controls inline-flex h-[1.3rem] min-w-[1.3rem] items-center justify-center rounded-full border px-[0.18rem] text-[0.58rem] leading-none font-semibold tabular-nums ${statusClassName}`}
    >
      {fps.value}
    </span>
  );
}

function DiagnosticDetails({ diagnostic }: { diagnostic: Entry }) {
  const displayKind = formatDiagnosticKind(diagnostic.kind);

  return (
    <div
      className={`rounded-[0.55rem] border border-border/[0.08] bg-background/[0.9] px-[0.55rem] py-[0.45rem] ${getDiagnosticKindClassName(displayKind)}`}
    >
      <div className="font-controls mb-[0.3rem] flex items-center justify-between gap-2 text-[0.78rem]">
        <span className="font-semibold text-slate-900">{displayKind}</span>
        <span className="text-muted">{formatTime(diagnostic.ts)}</span>
      </div>
      <pre className="m-0 whitespace-pre-wrap break-words text-[0.75rem]">
        {formatDetail(diagnostic.detail)}
      </pre>
    </div>
  );
}

// Subscribes to `DIAGNOSTIC_EVENT` on `window` and exposes a rolling list
// (capped at `MAX_ENTRIES`) plus a clear callback. Splitting the
// subscription out of the component body keeps the render focused on
// markup.
function useDiagnosticEntries() {
  const [list, setList] = useState<Entry[]>([]);
  const [fps, setFps] = useState<FpsReading | null>(null);
  const idRef = useRef(0);
  const fpsClearTimeoutRef = useRef<number | null>(null);

  const clearFpsTimeout = () => {
    if (fpsClearTimeoutRef.current === null) {
      return;
    }
    window.clearTimeout(fpsClearTimeoutRef.current);
    fpsClearTimeoutRef.current = null;
  };

  useEffect(() => {
    const handler = (event: Event) => {
      const { kind, detail, ts } = (event as CustomEvent<Diagnostic>).detail;

      if (kind === FPS_KIND) {
        const nextFps = parseFpsReading(detail);
        if (nextFps === null) {
          return;
        }
        setFps(nextFps);
        clearFpsTimeout();
        fpsClearTimeoutRef.current = window.setTimeout(() => {
          setFps(null);
          fpsClearTimeoutRef.current = null;
        }, FPS_STALE_CLEAR_MS);
        return;
      }

      idRef.current += 1;
      const entry: Entry = { id: idRef.current, kind, detail, ts };
      setList((prev) => {
        const next = [...prev, entry];
        return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
      });
    };
    window.addEventListener(DIAGNOSTIC_EVENT, handler);
    return () => {
      window.removeEventListener(DIAGNOSTIC_EVENT, handler);
      clearFpsTimeout();
    };
  }, []);

  return {
    clear: () => setList([]),
    fps,
    list,
  };
}

function parseFpsReading(detail: Record<string, unknown>): FpsReading | null {
  const cap = detail.cap;
  const capPending = detail.capPending;
  const value = detail.value;
  if (typeof cap !== "number" || typeof capPending !== "boolean" || typeof value !== "number") {
    return null;
  }
  return { cap: Math.round(cap), capPending, value: Math.round(value) };
}

// Pin the log scroll to the bottom whenever a new entry arrives. Returns
// the ref to attach to the scrollable container.
function useAutoScrollToBottom<T>(items: T[]) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);
  return ref;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour12: false });
}

function formatDetail(detail: Record<string, unknown>) {
  return Object.entries(detail)
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join("\n");
}

function formatDiagnosticKind(kind: string) {
  return kind.replace(/^documint:/, "");
}

function getDiagnosticKindClassName(kind: string) {
  switch (kind) {
    case "beforeinput":
      return "border-l-[3px] border-l-sky-500";
    case "input":
      return "border-l-[3px] border-l-indigo-500";
    case "compositionstart":
    case "compositionupdate":
    case "compositionend":
      return "border-l-[3px] border-l-amber-500";
    case "syncInputContext":
      return "border-l-[3px] border-l-emerald-500";
    case "editorStateEffect":
      return "border-l-[3px] border-l-teal-500";
    case "selectionchange":
      return "border-l-[3px] border-l-purple-500";
    default:
      return "border-l-[3px] border-l-slate-300";
  }
}

function formatValue(value: unknown) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || value === undefined || typeof value !== "object") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
