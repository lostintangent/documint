// Owns the editor's image-resource pipeline. Given the set of image URLs
// the document currently references (precomputed by the indexer during the
// walk it does anyway), resolves each one to a Blob via DocumentStorage
// (which handles remote vs. local routing) and decodes it into an
// `ImageBitmap` for the canvas painter.
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
import { type DocumentImageResource, type DocumentResources } from "@/types";
import type { DocumentStorage } from "../lib/storage";
import { imageUrlsValue, useStoreValue } from "../store";

export type ImagesApi = {
  resources: DocumentResources | null;
  persistImage: (file: File) => Promise<string | null>;
};

export function useImages(storage: DocumentStorage): ImagesApi {
  const imageUrls = useStoreValue(imageUrlsValue);
  const [imageResources, setImageResources] = useState<Map<string, DocumentImageResource>>(
    new Map(),
  );

  const reconcileImageLoads = useEffectEvent((urls: ReadonlySet<string>) => {
    if (typeof createImageBitmap === "undefined") {
      return; // SSR — no decode pipeline available.
    }

    const inactiveUrls = resolveInactiveImageUrls(imageResources, urls);
    const pendingUrls = resolvePendingImageUrls(imageResources, urls);

    if (inactiveUrls.length) {
      setImageResources((previous) => {
        const next = new Map(previous);
        for (const url of inactiveUrls) next.delete(url);
        return next;
      });
    }

    // The "loading" placeholder set here doubles as the dedup signal for
    // in-flight loads from prior reconciliations: effects run post-commit,
    // so by the next reconciliation the placeholder is visible here.
    for (const url of pendingUrls) {
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

function resolvePendingImageUrls(
  resources: Map<string, DocumentImageResource>,
  urls: ReadonlySet<string>,
) {
  return [...urls].filter((url) => {
    const status = resources.get(url)?.status;
    return status !== "loaded" && status !== "loading";
  });
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
