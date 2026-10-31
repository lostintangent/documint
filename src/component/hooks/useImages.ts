import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  resizeImage,
  type IndexedInline,
  type DocumentImageResource,
  type DocumentResourceRegistry,
  type DocumentResources,
} from "@/editor";
import type { DocumentStorage } from "../lib/storage";
import { imageAtCursorSprig, imageUrlsSprig, useEditorCommand, useSprig } from "../store";
import type { ResizeHandle } from "../Documint";

const IMAGE_MIN_WIDTH = 48;

type ImageResizeDrag = {
  direction: 1 | -1;
  image: IndexedInline;
  maxWidth: number | null;
  pointerId: number;
  startWidth: number;
  startX: number;
  startY: number;
};

type ImageHandleProps = {
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

export type ImagesApi = {
  hasLoadingImages: boolean;
  imageHandle: ResizeHandle | null;
  persistImage: (file: File) => Promise<string | null>;
  renderResources: DocumentResources;
};

export function useImages(
  readOnly: boolean,
  storage: DocumentStorage,
  resourceRegistry: DocumentResourceRegistry,
): ImagesApi {
  /* Referenced image resources */

  const imageUrls = useSprig(imageUrlsSprig);
  const [imageResources, setImageResources] = useState<Map<string, DocumentImageResource>>(
    new Map(),
  );
  const renderResources = useMemo<DocumentResources>(
    () => ({ images: imageResources, resourceRegistry }),
    [imageResources, resourceRegistry],
  );

  /* Image loading */

  // Placeholders reconcile during render, when the referenced URL set or
  // storage changes, so "loading" is visible in the same render. The effect
  // below starts loads for placeholders that have none in flight.
  const [reconciledInputs, setReconciledInputs] = useState<{
    readonly storage: DocumentStorage;
    readonly urls: ReadonlySet<string>;
  } | null>(null);
  if (reconciledInputs?.urls !== imageUrls || reconciledInputs?.storage !== storage) {
    setReconciledInputs({ storage, urls: imageUrls });
    setImageResources((previous) => reconcileImageResourceMap(previous, imageUrls));
  }

  const inFlightImageUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const inFlightUrls = inFlightImageUrlsRef.current;

    for (const [url, resource] of imageResources) {
      if (resource.status !== "loading" || inFlightUrls.has(url)) {
        continue;
      }

      inFlightUrls.add(url);
      void loadImage(url, storage).then((bitmap) => {
        inFlightUrls.delete(url);
        setImageResources((previous) => {
          // Evicted (or unmounted) before decode finished — drop the
          // bitmap so its pixels are freed immediately.
          if (!previous.has(url)) {
            bitmap?.close();
            return previous;
          }
          return withImageResource(
            previous,
            url,
            bitmap ? createImageResource("loaded", bitmap) : createImageResource("error"),
          );
        });
      });
    }
  }, [imageResources, storage]);

  /* Bitmap cleanup */

  // Free evicted bitmaps after the painter has redrawn without them.
  // Deliberately not on unmount: state survives StrictMode remount, and
  // closing here would orphan the remounted state.
  const previousResourcesRef = useRef<Map<string, DocumentImageResource>>(new Map());
  useEffect(() => {
    for (const [url, resource] of previousResourcesRef.current) {
      if (!imageResources.has(url)) {
        resource.source?.close();
      }
    }
    previousResourcesRef.current = imageResources;
  }, [imageResources]);

  /* Pasted image persistence */

  // Write a pasted blob to host storage and stash the decoded bitmap under
  // the returned path. Returns the path so the caller can splice the
  // matching markdown image into the document; the very next render's
  // reconcile sees the resource already loaded and skips the load.
  const persistImage = useEffectEvent(async (file: File) => {
    try {
      const path = await storage.writeFile(file);
      const bitmap = await createImageBitmap(file).catch(() => null);
      setImageResources((previous) =>
        withImageResource(
          previous,
          path,
          bitmap ? createImageResource("loaded", bitmap) : createImageResource("error"),
        ),
      );
      return path;
    } catch {
      return null;
    }
  });

  const hasLoadingImages = hasLoadingImageResource(imageResources);

  /* Selected image handle */

  const imageAtCursor = useSprig(imageAtCursorSprig, renderResources);
  const resizeSelectedImage = useEditorCommand(resizeImage);

  /* Resize drag */

  const resizeDragRef = useRef<ImageResizeDrag | null>(null);

  const startImageResize = useEffectEvent(
    (event: ReactPointerEvent<HTMLDivElement>, direction: 1 | -1) => {
      if (!imageAtCursor) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);

      resizeDragRef.current = {
        direction,
        image: imageAtCursor.inline,
        maxWidth: imageAtCursor.maxWidth,
        pointerId: event.pointerId,
        startWidth:
          imageAtCursor.inline.node.type === "image"
            ? (imageAtCursor.inline.node.width ?? imageAtCursor.bounds.width)
            : imageAtCursor.bounds.width,
        startX: event.clientX,
        startY: event.clientY,
      };
    },
  );

  const resizeImageFromDrag = useEffectEvent((event: ReactPointerEvent<HTMLDivElement>) => {
    const resizeDrag = resizeDragRef.current;
    const draggedImage = resizeDrag?.image;

    if (
      !resizeDrag ||
      resizeDrag.pointerId !== event.pointerId ||
      draggedImage?.node.type !== "image"
    ) {
      return;
    }

    const dx = event.clientX - resizeDrag.startX;
    const dy = event.clientY - resizeDrag.startY;
    const newWidth = Math.min(
      resizeDrag.maxWidth ?? Infinity,
      Math.max(
        IMAGE_MIN_WIDTH,
        Math.round(resizeDrag.startWidth + resizeDrag.direction * (dx + dy)),
      ),
    );

    resizeSelectedImage(
      {
        end: draggedImage.end,
        image: draggedImage.node,
        start: draggedImage.start,
      },
      newWidth,
    );
  });

  const endImageResize = useEffectEvent((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    resizeDragRef.current = null;
  });

  /* Image handle props */

  const startHandleProps: ImageHandleProps = {
    onPointerCancel: endImageResize,
    onPointerDown: (event) => startImageResize(event, -1),
    onPointerMove: resizeImageFromDrag,
    onPointerUp: endImageResize,
  };

  const endHandleProps: ImageHandleProps = {
    onPointerCancel: endImageResize,
    onPointerDown: (event) => startImageResize(event, 1),
    onPointerMove: resizeImageFromDrag,
    onPointerUp: endImageResize,
  };

  const imageHandle: ResizeHandle | null =
    readOnly || !imageAtCursor
      ? null
      : {
          start: {
            left: imageAtCursor.bounds.left,
            top: imageAtCursor.bounds.top,
            props: startHandleProps,
          },
          end: {
            left: imageAtCursor.bounds.left + imageAtCursor.bounds.width,
            props: endHandleProps,
            top: imageAtCursor.bounds.top + imageAtCursor.bounds.height,
          },
        };

  /* Public API */

  return { hasLoadingImages, imageHandle, persistImage, renderResources };
}

/* Loading pipeline */

async function loadImage(url: string, storage: DocumentStorage): Promise<ImageBitmap | null> {
  try {
    const blob = await storage.readFile(url);
    return blob ? await createImageBitmap(blob) : null;
  } catch {
    return null;
  }
}

/* Helpers */

function resolveInactiveImageUrls(
  resources: Map<string, DocumentImageResource>,
  urls: ReadonlySet<string>,
) {
  return [...resources.keys()].filter((url) => !urls.has(url));
}

function reconcileImageResourceMap(
  previous: Map<string, DocumentImageResource>,
  urls: ReadonlySet<string>,
): Map<string, DocumentImageResource> {
  if (typeof createImageBitmap === "undefined") {
    return previous;
  }

  const inactiveUrls = resolveInactiveImageUrls(previous, urls);
  const pendingUrls = resolvePendingImageUrls(previous, urls);
  if (inactiveUrls.length === 0 && pendingUrls.length === 0) {
    return previous;
  }

  const next = new Map(previous);
  for (const url of inactiveUrls) next.delete(url);
  for (const url of pendingUrls) next.set(url, createImageResource("loading"));
  return next;
}

function resolvePendingImageUrls(
  resources: Map<string, DocumentImageResource>,
  urls: ReadonlySet<string>,
) {
  return [...urls].filter((url) => {
    const status = resources.get(url)?.status;
    return status !== "loaded" && status !== "loading";
  });
}

function hasLoadingImageResource(resources: Map<string, DocumentImageResource>) {
  for (const resource of resources.values()) {
    if (resource.status === "loading") {
      return true;
    }
  }
  return false;
}

function withImageResource(
  previous: Map<string, DocumentImageResource>,
  url: string,
  resource: DocumentImageResource,
): Map<string, DocumentImageResource> {
  const next = new Map(previous);
  next.set(url, resource);
  return next;
}

function createImageResource(
  status: "error" | "loading",
  bitmap?: undefined,
): DocumentImageResource;
function createImageResource(status: "loaded", bitmap: ImageBitmap): DocumentImageResource;
function createImageResource(
  status: DocumentImageResource["status"],
  bitmap?: ImageBitmap,
): DocumentImageResource {
  return {
    intrinsicHeight: bitmap?.height ?? 0,
    intrinsicWidth: bitmap?.width ?? 0,
    source: bitmap ?? null,
    status,
  };
}
