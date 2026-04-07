import type { EditorPoint } from "@/editor";
import type { MouseEvent, PointerEvent } from "react";

type PointerLikeEvent =
  | Pick<PointerEvent<HTMLElement>, "clientX" | "clientY">
  | Pick<MouseEvent<HTMLElement>, "clientX" | "clientY">;

type ScrollContainerLike = Pick<
  HTMLElement,
  "getBoundingClientRect" | "scrollLeft" | "scrollTop"
>;

export function resolvePointerPointInScrollContainer(
  event: PointerLikeEvent,
  scrollContainer: ScrollContainerLike,
): EditorPoint {
  const bounds = scrollContainer.getBoundingClientRect();

  return {
    x: event.clientX - bounds.left + scrollContainer.scrollLeft,
    y: event.clientY - bounds.top + scrollContainer.scrollTop,
  };
}
