// Owns host-side image discovery, loading, and caching for the current
// document. The editor consumes the resulting document resources, but the
// browser lifecycle and async loading policy stay in the component layer.
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { collectImageUrls, type Document } from "@/document";
import {
  emptyDocumentResources,
  type DocumentImageResource,
  type DocumentResources,
} from "@/editor";

export function useDocumentImages(document: Document): DocumentResources {
  const imageUrls = useMemo(() => resolveDocumentImageUrls(document), [document]);
  const imageUrlSignature = useMemo(() => imageUrls.join("\n"), [imageUrls]);
  const [imageResources, setImageResources] = useState<Map<string, DocumentImageResource>>(new Map());
  const imageResourcesRef = useRef(imageResources);
  const pendingLoadsRef = useRef<Map<string, HTMLImageElement>>(new Map());

  imageResourcesRef.current = imageResources;

  useEffect(() => {
    if (typeof Image === "undefined") {
      return;
    }

    let isActive = true;
    const activeImageUrls = new Set<string>(imageUrls);
    const pendingLoads = pendingLoadsRef.current;

    setImageResources((previous) =>
      pruneInactiveImageResources(previous, activeImageUrls, pendingLoads),
    );

    for (const url of imageUrls) {
      if (hasReadyImageResource(imageResourcesRef.current, pendingLoads, url)) {
        continue;
      }

      startImageLoad(url, pendingLoads, setImageResources, () => isActive);
    }

    return () => {
      isActive = false;
    };
  }, [imageUrlSignature]);

  return useMemo(
    () =>
      imageResources.size === 0
        ? emptyDocumentResources
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
