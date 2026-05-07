import { useMemo, useRef, useEffectEvent } from "react";
import { resizeImage } from "@/editor";
import type { DocumentResources } from "@/types";
import { imageAtCursorValue, useEditorCommand, useStoreValue } from "../store";
import type { ResizeHandle } from "./useSelection";

const IMAGE_MIN_WIDTH = 48;

export function useImageHandles(resources: DocumentResources | null): ResizeHandle | null {
  const imageAtCursor = useStoreValue(imageAtCursorValue, resources);
  const resizeSelectedImage = useEditorCommand(resizeImage);
  const dragStartXRef = useRef<number | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const dragStartWidthRef = useRef<number | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragDirectionRef = useRef<1 | -1>(1);

  const onPointerDown = useEffectEvent(
    (event: React.PointerEvent<HTMLDivElement>, direction: 1 | -1) => {
      if (!imageAtCursor) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);

      dragPointerIdRef.current = event.pointerId;
      dragStartXRef.current = event.clientX;
      dragStartYRef.current = event.clientY;
      dragStartWidthRef.current = imageAtCursor.run.image?.width ?? imageAtCursor.bounds.width;
      dragDirectionRef.current = direction;
    },
  );

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
      Math.max(
        IMAGE_MIN_WIDTH,
        Math.round(dragStartWidthRef.current + dragDirectionRef.current * (dx + dy)),
      ),
    );
    const imageRun = {
      end: imageAtCursor.run.end,
      image: imageAtCursor.run.image,
      start: imageAtCursor.run.start,
    };

    resizeSelectedImage(imageAtCursor.regionId, imageRun, newWidth);
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

  const startProps = useMemo(
    () => ({
      onPointerCancel: onPointerUp,
      onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => onPointerDown(e, -1),
      onPointerMove,
      onPointerUp,
    }),
    [],
  );

  const endProps = useMemo(
    () => ({
      onPointerCancel: onPointerUp,
      onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => onPointerDown(e, 1),
      onPointerMove,
      onPointerUp,
    }),
    [],
  );

  return useMemo((): ResizeHandle | null => {
    if (!imageAtCursor) return null;
    const { bounds } = imageAtCursor;
    return {
      start: { left: bounds.left, top: bounds.top, props: startProps },
      end: {
        left: bounds.left + bounds.width,
        props: endProps,
        top: bounds.top + bounds.height,
      },
    };
  }, [imageAtCursor]);
}
