import type { Mark } from "@/document";
import type { EditorState } from "./model/state";

export type CanvasActiveBlockRegion = {
  blockId: string;
  depth: number;
  nodeType: string;
  text: string;
};

export type CanvasActiveSpanRegion =
  | {
      kind: "link";
      url: string;
    }
  | {
      kind: "marks";
      marks: Mark[];
    }
  | {
      kind: "none";
    };

export type CanvasEditablePreviewState = {
  activeBlock: CanvasActiveBlockRegion | null;
  activeSpan: CanvasActiveSpanRegion;
};

export function getCanvasEditablePreviewState(state: EditorState): CanvasEditablePreviewState {
  const container = state.documentEditor.regions.find(
    (entry) => entry.id === state.selection.anchor.regionId,
  );
  const block = container
    ? state.documentEditor.blocks.find((entry) => entry.id === container.blockId) ?? null
    : null;
  const offset = state.selection.anchor.offset;
  const run =
    container?.runs.find((entry) => offset > entry.start && offset < entry.end) ??
    container?.runs.find((entry) => entry.end === offset) ??
    container?.runs.find((entry) => entry.start === offset) ??
    null;

  return {
    activeBlock: block
      ? {
          blockId: block.id,
          depth: block.depth,
          nodeType: block.type,
          text: container?.text ?? "",
        }
      : null,
    activeSpan: run?.link
      ? {
          kind: "link",
          url: run.link.url,
        }
      : run && run.marks.length > 0
        ? {
            kind: "marks",
            marks: run.marks,
          }
        : {
            kind: "none",
          },
  };
}
