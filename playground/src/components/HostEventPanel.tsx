import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import type { PlaygroundHostEvent } from "../lib/events";

type CopyStatus = "idle" | "copied" | "failed";
type CopyFeedbackStatus = Exclude<CopyStatus, "idle">;
type CopyStatusView = {
  ariaSuffix?: string;
  className: string;
  title: string;
};

const hostEventCopyPillClassName =
  "font-code [overflow-wrap:anywhere] whitespace-normal rounded-md border px-1.5 py-0.5 cursor-copy appearance-none text-left transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const HOST_EVENT_COPY_FEEDBACK_MS = 2_000;
const copyStatusView: Record<CopyStatus, CopyStatusView> = {
  copied: {
    ariaSuffix: "(copied)",
    className: "border-emerald-500/35 bg-emerald-50 text-emerald-700",
    title: "Copied to clipboard",
  },
  failed: {
    ariaSuffix: "(copy failed)",
    className: "border-red-500/35 bg-red-50 text-red-700",
    title: "Copy failed",
  },
  idle: {
    className: "border-border/15 bg-background/90 hover:bg-border/5",
    title: "Copy to clipboard",
  },
};

export function HostEventPanel({
  event,
  onClear,
  onHidden,
  visible,
}: {
  event: PlaygroundHostEvent | null;
  onClear: () => void;
  onHidden: () => void;
  visible: boolean;
}) {
  return (
    <section
      aria-live="polite"
      className={`min-w-0 self-start overflow-hidden transition-[max-height,margin-bottom] duration-150 ease-in-out ${
        visible ? "mb-4 max-h-[min(18rem,45vh)]" : "mb-0 max-h-0"
      }`}
      onTransitionEnd={(transitionEvent) => {
        if (transitionEvent.propertyName === "max-height" && !visible) {
          onHidden();
        }
      }}
    >
      <div className="min-w-0">
        {event ? (
          <div className="font-controls grid min-w-0 translate-y-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-xl border border-border/10 bg-background/80 px-3 py-2 text-sm opacity-100 transition-[opacity,transform] duration-150 ease-in-out starting:translate-y-[-0.65rem] starting:opacity-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="flex-none font-semibold">{event.title}</span>
              {event.fields.map(([key, value]) => (
                <CopyableHostEventPill
                  ariaLabel={`Copy ${key} value`}
                  copyValue={String(value)}
                  key={key}
                >
                  {key}={value}
                </CopyableHostEventPill>
              ))}
              <CopyableHostEventPill
                ariaLabel="Copy event detail"
                className="min-w-0 flex-[1_1_18rem]"
                copyValue={event.detail}
              >
                {event.detail}
              </CopyableHostEventPill>
            </div>
            <button
              aria-label="Clear host event"
              className="inline-flex size-7 cursor-pointer items-center justify-center rounded-full border border-border/15 bg-background/90 p-0 text-muted transition-colors duration-150 hover:bg-border/5 hover:text-inherit"
              onClick={onClear}
              type="button"
            >
              <X aria-hidden size={16} strokeWidth={2} />
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CopyableHostEventPill({
  ariaLabel,
  children,
  className = "",
  copyValue,
}: {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  copyValue: string;
}) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const copyFeedbackTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setCopyStatus("idle");
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
        copyFeedbackTimeoutRef.current = null;
      }
    };
  }, [copyValue]);

  const showCopyStatus = (status: CopyFeedbackStatus) => {
    if (copyFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(copyFeedbackTimeoutRef.current);
    }

    setCopyStatus(status);
    copyFeedbackTimeoutRef.current = window.setTimeout(() => {
      setCopyStatus("idle");
      copyFeedbackTimeoutRef.current = null;
    }, HOST_EVENT_COPY_FEEDBACK_MS);
  };

  const statusView = copyStatusView[copyStatus];

  const copyToClipboard = async () => {
    if (!navigator.clipboard) {
      console.error("Clipboard API is unavailable in this browser context.");
      showCopyStatus("failed");
      return;
    }

    try {
      await navigator.clipboard.writeText(copyValue);
      showCopyStatus("copied");
    } catch (error: unknown) {
      console.error("Failed to copy host event value.", error);
      showCopyStatus("failed");
    }
  };

  return (
    <button
      aria-label={statusView.ariaSuffix ? `${ariaLabel} ${statusView.ariaSuffix}` : ariaLabel}
      className={`${hostEventCopyPillClassName} ${statusView.className} ${className}`}
      onClick={() => void copyToClipboard()}
      title={statusView.title}
      type="button"
    >
      {children}
      {copyStatus === "copied" ? (
        <Check
          aria-hidden
          className="ml-1.5 inline-block align-[-0.12rem]"
          size={14}
          strokeWidth={2.4}
        />
      ) : null}
      {copyStatus === "failed" ? (
        <span aria-hidden className="font-controls ml-1.5 text-xs font-semibold">
          Copy failed
        </span>
      ) : null}
    </button>
  );
}
