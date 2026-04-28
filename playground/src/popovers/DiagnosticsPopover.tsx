import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
// Imported directly from the library's internal diagnostics module rather
// than from `documint`'s public API — diagnostics are dev-only tooling for
// the playground, not a stable public surface.
import { DIAGNOSTIC_EVENT, type Diagnostic } from "@/component/lib/diagnostics";
import { PlaygroundPopover } from "./PlaygroundPopover";
import "./DiagnosticsPopover.css";

// Most recent N diagnostic events to keep in memory. The popover is
// inspection-time tooling; older events are dropped silently.
const MAX_ENTRIES = 200;

type Entry = Diagnostic & { id: number };

/**
 * Live log of diagnostic events emitted by the editor (see
 * `src/component/lib/diagnostics.ts`). Renders as a popover next to the
 * playground header's other controls; each entry shows kind, time, and a
 * pretty-printed view of its detail payload.
 *
 * Only mounted in the dev playground — `Playground.tsx` gates the JSX
 * behind `process.env.NODE_ENV !== "production"`, so the deployable demo
 * (and any other production-shaped build) tree-shakes both this component
 * and its CSS-in-JS counterpart away.
 */
export function DiagnosticsPopover() {
  const entries = useDiagnosticEntries();
  const listRef = useAutoScrollToBottom(entries.list);

  return (
    <PlaygroundPopover
      ariaLabel="Input diagnostics"
      containerClassName="diag-controls"
      flyoutClassName="diag-flyout"
      icon={<Activity size={16} strokeWidth={2.1} />}
      iconClassName="diag-toggle-icon"
      showSwatch={false}
    >
      <div className="presence-header">
        <strong>
          Input diagnostics
          {entries.list.length > 0 ? ` (${entries.list.length})` : ""}
        </strong>
        <button className="diag-log-clear" onClick={entries.clear} type="button">
          Clear
        </button>
      </div>
      <div className="diag-log-list" ref={listRef}>
        {entries.list.length === 0 ? (
          <p className="diag-log-empty">
            Waiting for input events… (focus the editor and type / dictate / move the caret)
          </p>
        ) : (
          entries.list.map((entry) => <DiagnosticDetails diagnostic={entry} key={entry.id} />)
        )}
      </div>
    </PlaygroundPopover>
  );
}

function DiagnosticDetails({ diagnostic }: { diagnostic: Entry }) {
  return (
    <div className={`diag-log-entry diag-kind-${diagnostic.kind}`}>
      <div className="diag-log-entry-head">
        <span className="diag-log-kind">{diagnostic.kind}</span>
        <span className="diag-log-time">{formatTime(diagnostic.ts)}</span>
      </div>
      <pre className="diag-log-detail">{formatDetail(diagnostic.detail)}</pre>
    </div>
  );
}

// Subscribes to `DIAGNOSTIC_EVENT` on `window` and exposes a rolling list
// (capped at `MAX_ENTRIES`) plus a clear callback. Splitting the
// subscription out of the component body keeps the render focused on
// markup.
function useDiagnosticEntries() {
  const [list, setList] = useState<Entry[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    const handler = (event: Event) => {
      const { kind, detail, ts } = (event as CustomEvent<Diagnostic>).detail;
      idRef.current += 1;
      const entry: Entry = { id: idRef.current, kind, detail, ts };
      setList((prev) => {
        const next = [...prev, entry];
        return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
      });
    };
    window.addEventListener(DIAGNOSTIC_EVENT, handler);
    return () => window.removeEventListener(DIAGNOSTIC_EVENT, handler);
  }, []);

  return {
    clear: () => setList([]),
    list,
  };
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

function formatValue(value: unknown) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || value === undefined || typeof value !== "object") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
