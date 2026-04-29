import { useMemo, useRef, useEffectEvent } from "react";
import { resizeImage } from "@/editor/state/commands";
import type { EditorState } from "@/editor";
import type { ImageAtCursor } from "./useCursor";
import type { ResizeHandle } from "./useSelection";

const IMAGE_MIN_WIDTH = 48;

export function useImageHandles(
  imageAtCursor: ImageAtCursor | null,
  editorState: EditorState,
  onStateChange: (next: EditorState) => void,
): ResizeHandle | null {
  const dragStartXRef = useRef<number | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const dragStartWidthRef = useRef<number | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragDirectionRef = useRef<1 | -1>(1);

  const onPointerDown = useEffectEvent((event: React.PointerEvent<HTMLDivElement>, direction: 1 | -1) => {
    if (!imageAtCursor) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    dragPointerIdRef.current = event.pointerId;
    dragStartXRef.current = event.clientX;
    dragStartYRef.current = event.clientY;
    dragStartWidthRef.current = imageAtCursor.run.image?.width ?? imageAtCursor.bounds.width;
    dragDirectionRef.current = direction;
  });

  const onPointerMove = useEffectEvent((event: React.PointerEvent<HTMLDivElement>) => {
    if (
      dragPointerIdRef.current !== event.pointerId ||
      dragStartXRef.current === null ||
      dragStartYRef.current === null ||
      dragStartWidthRef.current === null ||
      !imageAtCursor?.run.image
    ) {
      return;
    }

    const dx = event.clientX - dragStartXRef.current;
    const dy = event.clientY - dragStartYRef.current;
    const newWidth = Math.min(
      imageAtCursor.maxWidth ?? Infinity,
      Math.max(IMAGE_MIN_WIDTH, Math.round(dragStartWidthRef.current + dragDirectionRef.current * (dx + dy))),
    );

    const nextState = resizeImage(editorState, imageAtCursor.regionId, imageAtCursor.run as typeof imageAtCursor.run & { image: NonNullable<typeof imageAtCursor.run["image"]> }, newWidth);
    if (nextState) onStateChange(nextState);
  });

  const onPointerUp = useEffectEvent((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    
    dragPointerIdRef.current = null;
    dragStartXRef.current = null;
    dragStartYRef.current = null;
    dragStartWidthRef.current = null;
  });

  const startProps = useMemo(() => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => onPointerDown(e, -1),
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  }), []);

  const endProps = useMemo(() => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => onPointerDown(e, 1),
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  }), []);

  return useMemo((): ResizeHandle | null => {
    if (!imageAtCursor) return null;
    const { bounds } = imageAtCursor;
    return {
      start: { left: bounds.left, top: bounds.top, props: startProps },
      end: { left: bounds.left + bounds.width, top: bounds.top + bounds.height, props: endProps },
    };
  }, [imageAtCursor]);
}
