import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
// Imported directly from the library's internal diagnostics module rather
// than from `documint`'s public API — diagnostics are dev-only tooling for
// the playground, not a stable public surface.
import { DIAGNOSTIC_EVENT, type Diagnostic } from "@/component/lib/diagnostics";
import {
  PlaygroundPopover,
  popoverControlClassName,
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

const clearButtonClassName = `${popoverControlClassName} rounded-[0.6rem] px-[0.6rem] py-1 text-[0.8rem]`;
const diagnosticListClassName = "grid min-h-0 content-start gap-[0.4rem] overflow-y-auto";
const diagnosticEntryClassName =
  "rounded-[0.55rem] border border-border/[0.08] bg-background/[0.9] px-[0.55rem] py-[0.45rem]";
const diagnosticEntryHeaderClassName =
  "font-controls mb-[0.3rem] flex items-center justify-between gap-2 text-[0.78rem]";
const diagnosticDetailClassName = "m-0 whitespace-pre-wrap break-words text-[0.75rem]";
const diagnosticFlyoutClassName =
  "font-code max-h-[min(70vh,36rem)] grid-rows-[auto_minmax(0,1fr)] text-[0.78rem] leading-[1.4] max-[700px]:portrait:max-h-[min(60vh,30rem)]";

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
export function DiagnosticsPopover() {
  const entries = useDiagnosticEntries();
  const listRef = useAutoScrollToBottom(entries.list);

  return (
    <PlaygroundPopover
      ariaLabel="Input diagnostics"
      flyoutClassName={diagnosticFlyoutClassName}
      icon={<DiagnosticsIcon fps={entries.fps} />}
      size="lg"
      showSwatch={false}
    >
      <div className={popoverHeaderClassName}>
        <strong className={popoverTitleClassName}>
          Input diagnostics
          {entries.list.length > 0 ? ` (${entries.list.length})` : ""}
        </strong>
        <button className={clearButtonClassName} onClick={entries.clear} type="button">
          Clear
        </button>
      </div>
      <div className={diagnosticListClassName} ref={listRef}>
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
    <div className={`${diagnosticEntryClassName} ${getDiagnosticKindClassName(displayKind)}`}>
      <div className={diagnosticEntryHeaderClassName}>
        <span className="font-semibold text-slate-900">{displayKind}</span>
        <span className="text-muted">{formatTime(diagnostic.ts)}</span>
      </div>
      <pre className={diagnosticDetailClassName}>{formatDetail(diagnostic.detail)}</pre>
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
