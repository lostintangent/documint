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
import { tokenizeTriggers } from "../../../lib/mentions";
import type { CompletionSource } from "./LeafInput";

type LeafOutputProps = {
  value: string;
  completionSources?: CompletionSource[];
  onEdit?: () => void;
};

export function LeafOutput({ value, completionSources, onEdit }: LeafOutputProps) {
  return <p onDoubleClick={onEdit}>{renderSegments(value, completionSources)}</p>;
}

function renderSegments(
  value: string,
  completionSources: CompletionSource[] | undefined,
): ReactNode {
  const segments = tokenizeTriggers(value, completionSources);
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
