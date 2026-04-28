// Owns the editor's image-resource pipeline. Given the set of image URLs
// the document currently references (precomputed by the indexer during the
// walk it does anyway), decodes each one into an `ImageBitmap` — directly
// via `createImageBitmap(blob)` for host-storage-resolved local URLs, or
// via `<img>` followed by `createImageBitmap(image)` for remote URLs — and
// exposes the results as `DocumentResources` for the canvas painter.
//
// Also owns the write path: `persistImage(file)` hands a pasted file to
// the host's storage, decodes it locally, and stashes the result in state
// under the path the host returned. The next render that splices
// `![](path)` into the document finds the resource already loaded — no
// "loading" flash, no readback round-trip through storage.
//
// Using `ImageBitmap` as the universal paint source is what keeps this
// hook simple: the bitmap holds its own pixels, so there's no string
// handle (object URL) whose lifecycle we'd otherwise have to coordinate
// with eviction, decode failure, and unmount. GC reclaims unused bitmaps
// once their references drop from state.

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  type DocumentImageResource,
  type DocumentResources,
  type DocumintStorage,
} from "@/types";

export type ImagesApi = {
  resources: DocumentResources | null;
  persistImage: (file: File) => Promise<string | null>;
};

export function useImages(
  imageUrls: ReadonlySet<string>,
  storage?: DocumintStorage,
): ImagesApi {
  const [imageResources, setImageResources] = useState<Map<string, DocumentImageResource>>(
    new Map(),
  );

  const reconcileImageLoads = useEffectEvent((urls: ReadonlySet<string>) => {
    if (typeof Image === "undefined") {
      return; // SSR — no decode pipeline available.
    }

    const inactiveUrls = [...imageResources.keys()].filter((url) => !urls.has(url));
    if (inactiveUrls.length > 0) {
      setImageResources((previous) => {
        const next = new Map(previous);
        for (const url of inactiveUrls) next.delete(url);
        return next;
      });
    }

    // The "loading" placeholder set here doubles as the dedup signal for
    // in-flight loads from prior reconciliations: effects run post-commit,
    // so by the next reconciliation the placeholder is visible here.
    for (const url of urls) {
      const status = imageResources.get(url)?.status;
      if (status === "loaded" || status === "loading") continue;

      setImageResources((previous) =>
        withImageResource(previous, url, createImageResource("loading")),
      );

      void loadImage(url, storage).then((bitmap) => {
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
  });

  useEffect(() => {
    reconcileImageLoads(imageUrls);
  }, [imageUrls]);

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

  // Write a pasted blob to host storage and stash the decoded bitmap under
  // the returned path. Returns the path so the caller can splice the
  // matching markdown image into the document; the very next render's
  // reconcile sees the resource already loaded and skips the load.
  const persistImage = useEffectEvent(async (file: File) => {
    if (!storage?.writeFile) return null;
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

  const resources = useMemo(
    () =>
      imageResources.size === 0
        ? null
        : {
            images: imageResources,
          },
    [imageResources],
  );

  return useMemo(() => ({ resources, persistImage }), [resources, persistImage]);
}

/* Loading pipeline */

// Loads a single image. Returns the decoded `ImageBitmap` on success, or
// `null` on any failure (resolution failed, decode failed, host has no
// storage to resolve a local URL).
async function loadImage(
  url: string,
  storage: DocumintStorage | undefined,
): Promise<ImageBitmap | null> {
  // http(s):, data:, blob: load directly via <img>.src. Everything else
  // (file:, relative, app-scheme:, bare filename) is "local" and routes
  // through the host's storage.readFile.
  if (/^(https?:|data:|blob:)/i.test(url)) {
    return decodeImageFromUrl(url);
  }

  if (!storage?.readFile) {
    return null;
  }

  try {
    const blob = await storage.readFile(url);
    return blob ? await createImageBitmap(blob) : null;
  } catch {
    return null;
  }
}

// Fetches a remote URL via `<img>` (preserving the existing CORS and cache
// behavior of image loading) and converts the loaded element into an
// `ImageBitmap` for uniform paint-source handling.
function decodeImageFromUrl(url: string): Promise<ImageBitmap | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.crossOrigin = "anonymous";
    image.onload = async () => {
      try {
        resolve(await createImageBitmap(image));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/* Helpers */

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
