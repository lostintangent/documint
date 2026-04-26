// Read-only complement to LeafInput. Renders a leaf's text content with
// trigger-prefixed tokens (e.g. "@Jane Doe") highlighted as inline pills
// when they match an item in completionSources — the same configuration
// LeafInput uses to power its completion popover. The pair gives the editor
// a unified mental model: "completion sources" describes the recognized
// tokens for both writing and reading.
//
// An optional onEdit handler wires double-click-to-edit, so callers don't
// repeat the wrapper element + handler at every read-only call site.
import { Fragment, type ReactNode } from "react";
import type { CompletionSource } from "./LeafInput";

type LeafOutputProps = {
  value: string;
  completionSources?: CompletionSource[];
  onEdit?: () => void;
};

type LeafSegment =
  | { kind: "text"; text: string }
  | { kind: "token"; trigger: string; label: string };

export function LeafOutput({ value, completionSources, onEdit }: LeafOutputProps) {
  return <p onDoubleClick={onEdit}>{renderSegments(value, completionSources)}</p>;
}

function renderSegments(
  value: string,
  completionSources: CompletionSource[] | undefined,
): ReactNode {
  const segments = parseSegments(value, completionSources);
  if (segments.length === 1 && segments[0].kind === "text") {
    return value;
  }
  return segments.map((segment, index) =>
    segment.kind === "token" ? (
      <span className="documint-mention" key={index}>
        {segment.trigger}
        {segment.label}
      </span>
    ) : (
      <Fragment key={index}>{segment.text}</Fragment>
    ),
  );
}

// Split text into runs of plain content and trigger-prefixed tokens that
// match a completion source label. Labels within a source are matched
// longest-first so "Jane Doe" wins over "Jane" when both are present.
function parseSegments(value: string, sources: CompletionSource[] | undefined): LeafSegment[] {
  if (!sources?.length || !sources.some((source) => value.includes(source.trigger))) {
    return [{ kind: "text", text: value }];
  }

  const labelsByTrigger = new Map<string, string[]>();
  for (const source of sources) {
    const sorted = source.items.map((item) => item.label).sort((a, b) => b.length - a.length);
    labelsByTrigger.set(source.trigger, sorted);
  }

  const segments: LeafSegment[] = [];
  let cursor = 0;
  let textStart = 0;

  while (cursor < value.length) {
    const char = value[cursor];
    const labels = labelsByTrigger.get(char);
    const isTriggerCandidate =
      labels !== undefined && (cursor === 0 || isTokenBoundary(value[cursor - 1]));

    if (isTriggerCandidate) {
      const label = labels.find((candidate) => value.startsWith(candidate, cursor + 1));
      if (label) {
        if (cursor > textStart) {
          segments.push({ kind: "text", text: value.slice(textStart, cursor) });
        }
        segments.push({ kind: "token", trigger: char, label });
        cursor += 1 + label.length;
        textStart = cursor;
        continue;
      }
    }

    cursor += 1;
  }

  if (textStart < value.length) {
    segments.push({ kind: "text", text: value.slice(textStart) });
  }

  return segments;
}

function isTokenBoundary(char: string): boolean {
  return char === " " || char === "\n" || char === "\t";
}
