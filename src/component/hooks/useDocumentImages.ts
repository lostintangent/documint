// Owns host-side image discovery, loading, and caching for the current
// document. The editor consumes the resulting document resources, but the
// browser lifecycle and async loading policy stay in the component layer.
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { collectImageUrls, type Document } from "@/document";
import { type DocumentImageResource, type DocumentResources } from "@/types";

export function useDocumentImages(document: Document): DocumentResources | null {
  const imageUrls = useMemo(() => resolveDocumentImageUrls(document), [document]);
  const imageUrlSignature = useMemo(() => imageUrls.join("\n"), [imageUrls]);
  const [imageResources, setImageResources] = useState<Map<string, DocumentImageResource>>(
    new Map(),
  );
  const pendingLoadsRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Reconcile in-flight loads against the current URL set. Reads `imageResources`
  // from closure so the wrapping effect can stay reactive only to URL changes —
  // depending on resources directly would loop, since we call `setImageResources`
  // here on every reconciliation.
  const reconcileImageLoads = useEffectEvent((urls: string[], isActive: () => boolean) => {
    if (typeof Image === "undefined") {
      return;
    }

    const activeImageUrls = new Set<string>(urls);
    const pendingLoads = pendingLoadsRef.current;

    setImageResources((previous) =>
      pruneInactiveImageResources(previous, activeImageUrls, pendingLoads),
    );

    for (const url of urls) {
      if (hasReadyImageResource(imageResources, pendingLoads, url)) {
        continue;
      }

      startImageLoad(url, pendingLoads, setImageResources, isActive);
    }
  });

  useEffect(() => {
    let active = true;
    reconcileImageLoads(imageUrls, () => active);
    return () => {
      active = false;
    };
  }, [imageUrlSignature]);

  return useMemo(
    () =>
      imageResources.size === 0
        ? null
        : {
            images: imageResources,
          },
    [imageResources],
  );
}

function resolveDocumentImageUrls(document: Document) {
  return [...collectImageUrls(document)].sort();
}

function hasReadyImageResource(
  imageResources: Map<string, DocumentImageResource>,
  pendingLoads: Map<string, HTMLImageElement>,
  url: string,
) {
  return imageResources.get(url)?.status === "loaded" || pendingLoads.has(url);
}

function pruneInactiveImageResources(
  previous: Map<string, DocumentImageResource>,
  activeImageUrls: Set<string>,
  pendingLoads: Map<string, HTMLImageElement>,
) {
  let didChange = false;
  const next = new Map(previous);

  for (const url of next.keys()) {
    if (!activeImageUrls.has(url)) {
      next.delete(url);
      pendingLoads.delete(url);
      didChange = true;
    }
  }

  return didChange ? next : previous;
}

function startImageLoad(
  url: string,
  pendingLoads: Map<string, HTMLImageElement>,
  setImageResources: Dispatch<SetStateAction<Map<string, DocumentImageResource>>>,
  isActive: () => boolean,
) {
  const image = new Image();
  image.decoding = "async";
  image.crossOrigin = "anonymous";
  pendingLoads.set(url, image);

  setImageResources((previous) => {
    const next = new Map(previous);
    next.set(url, createLoadingImageResource());
    return next;
  });

  image.onload = () => {
    pendingLoads.delete(url);

    if (!isActive()) {
      return;
    }

    setImageResources((previous) => {
      const next = new Map(previous);
      next.set(url, createLoadedImageResource(image));
      return next;
    });
  };

  image.onerror = () => {
    pendingLoads.delete(url);

    if (!isActive()) {
      return;
    }

    setImageResources((previous) => {
      const next = new Map(previous);
      next.set(url, createErroredImageResource());
      return next;
    });
  };

  image.src = url;
}

function createLoadingImageResource(): DocumentImageResource {
  return {
    intrinsicHeight: 0,
    intrinsicWidth: 0,
    source: null,
    status: "loading",
  };
}

function createLoadedImageResource(image: HTMLImageElement): DocumentImageResource {
  return {
    intrinsicHeight: image.naturalHeight,
    intrinsicWidth: image.naturalWidth,
    source: image,
    status: "loaded",
  };
}

function createErroredImageResource(): DocumentImageResource {
  return {
    intrinsicHeight: 0,
    intrinsicWidth: 0,
    source: null,
    status: "error",
  };
}
