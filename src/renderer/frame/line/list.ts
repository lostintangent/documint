import type { EditorLayoutState } from "@/editor/layout";
import type { ActiveBlockPulse } from "../../effects";
import {
  resolveListMarkerFrame,
  type ListMarkerFrame,
  type ListMarkerPlan,
} from "../chrome/list-markers";

export function resolveDocumentFrameLineList({
  blockPulses,
  line,
  textBaseline,
  textLeft,
  listMarkerPlans,
}: {
  blockPulses: Map<string, ActiveBlockPulse>;
  line: EditorLayoutState["layout"]["lines"][number];
  textBaseline: number;
  textLeft: number;
  listMarkerPlans: Map<string, ListMarkerPlan>;
}): {
  blockPulse: ActiveBlockPulse | null;
  listMarker: ListMarkerFrame | null;
} {
  const listMarkerPlan = listMarkerPlans.get(line.blockId) ?? null;

  return {
    blockPulse: listMarkerPlan ? (blockPulses.get(listMarkerPlan.blockPath) ?? null) : null,
    listMarker: resolveListMarkerFrame(
      listMarkerPlan?.marker ?? null,
      line,
      textLeft,
      textBaseline,
    ),
  };
}
