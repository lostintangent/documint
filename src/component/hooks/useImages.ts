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
import { resolveDevicePixelRatio } from "../lib/canvas";
import { REMOTE_URL, type DocumentStorage } from "../lib/storage";
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
      void loadImage(url, storage).then((image) => {
        inFlightUrls.delete(url);
        setImageResources((previous) => {
          // Evicted (or unmounted) before decode finished — drop the
          // bitmap so its pixels are freed immediately.
          if (!previous.has(url)) {
            image?.bitmap.close();
            return previous;
          }
          return withImageResource(
            previous,
            url,
            image ? createImageResource("loaded", image) : createImageResource("error"),
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
      const image = await decodeImageBlob(file);
      setImageResources((previous) =>
        withImageResource(
          previous,
          path,
          image ? createImageResource("loaded", image) : createImageResource("error"),
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

  const createHandleProps = (direction: 1 | -1): ImageHandleProps => ({
    onPointerCancel: endImageResize,
    onPointerDown: (event) => startImageResize(event, direction),
    onPointerMove: resizeImageFromDrag,
    onPointerUp: endImageResize,
  });

  const imageHandle: ResizeHandle | null =
    readOnly || !imageAtCursor
      ? null
      : {
          start: {
            left: imageAtCursor.bounds.left,
            top: imageAtCursor.bounds.top,
            props: createHandleProps(-1),
          },
          end: {
            left: imageAtCursor.bounds.left + imageAtCursor.bounds.width,
            props: createHandleProps(1),
            top: imageAtCursor.bounds.top + imageAtCursor.bounds.height,
          },
        };

  /* Public API */

  return { hasLoadingImages, imageHandle, persistImage, renderResources };
}

/* Loading pipeline */

// Vectors rasterize at device resolution, so layout uses the natural size.
type DecodedImage = { bitmap: ImageBitmap; height: number; width: number };

// Bytes from fetch or host storage decode first, and host paths never load by
// URL. An `<img>` decodes the rest: Chromium can't decode SVG blobs, and badge
// hosts like GitHub's send no CORS headers. Cross-origin images taint the
// canvas, which is safe because nothing reads its pixels back.
export async function loadImage(url: string, storage: DocumentStorage) {
  const blob = await storage.readFile(url).catch(() => null);
  if (blob) return decodeImageBlob(blob);
  return REMOTE_URL.test(url) ? decodeImageElement(url) : null;
}

async function decodeImageBlob(blob: Blob): Promise<DecodedImage | null> {
  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (bitmap) return { bitmap, height: bitmap.height, width: bitmap.width };

  const url = URL.createObjectURL(blob);
  try {
    return await decodeImageElement(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Small images rasterize at device resolution so SVGs stay crisp. Large ones
// are mostly raster screenshots that would only grow in memory. Drawing into a
// canvas, rather than `createImageBitmap(image)`, is what lets Chromium
// rasterize an SVG that only has a viewBox.
async function decodeImageElement(src: string): Promise<DecodedImage | null> {
  const image = new Image();
  image.src = src;

  try {
    await image.decode();
    const { naturalHeight: height, naturalWidth: width } = image;
    const pixelRatio = resolveDevicePixelRatio();
    const scale = width * height * pixelRatio ** 2 <= 1e6 ? pixelRatio : 1;
    const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale));
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { bitmap: canvas.transferToImageBitmap(), height, width };
  } catch {
    return null;
  }
}

/* Helpers */

function reconcileImageResourceMap(
  previous: Map<string, DocumentImageResource>,
  urls: ReadonlySet<string>,
): Map<string, DocumentImageResource> {
  if (typeof createImageBitmap === "undefined") {
    return previous;
  }

  const inactiveUrls = [...previous.keys()].filter((url) => !urls.has(url));
  const pendingUrls = [...urls].filter((url) => {
    const status = previous.get(url)?.status;
    return status !== "loaded" && status !== "loading";
  });
  if (inactiveUrls.length === 0 && pendingUrls.length === 0) {
    return previous;
  }

  const next = new Map(previous);
  for (const url of inactiveUrls) next.delete(url);
  for (const url of pendingUrls) next.set(url, createImageResource("loading"));
  return next;
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

function createImageResource(status: "error" | "loading", image?: undefined): DocumentImageResource;
function createImageResource(status: "loaded", image: DecodedImage): DocumentImageResource;
function createImageResource(
  status: DocumentImageResource["status"],
  image?: DecodedImage,
): DocumentImageResource {
  return {
    intrinsicHeight: image?.height ?? 0,
    intrinsicWidth: image?.width ?? 0,
    source: image?.bitmap ?? null,
    status,
  };
}
