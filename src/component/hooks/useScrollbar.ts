import { useEffect, useEffectEvent, useRef, type PointerEvent, type WheelEvent } from "react";

const SCROLLBAR_IDLE_DELAY_MS = 500;
const SCROLLBAR_MINIMUM_HEIGHT = 16;
const SCROLLBAR_VERTICAL_INSET = 1;
const WHEEL_LINE_HEIGHT = 16;

type ScrollbarDrag = {
  pointerId: number;
  startClientY: number;
  startScrollTop: number;
  scrollHeight: number;
  viewportHeight: number;
};

export function useScrollbar() {
  const dragRef = useRef<ScrollbarDrag | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollbarRef = useRef<HTMLDivElement | null>(null);
  const clearHideTimeout = useEffectEvent(() => {
    if (hideTimeoutRef.current !== null) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  });
  const scheduleHide = useEffectEvent((scrollbar: HTMLDivElement) => {
    clearHideTimeout();
    hideTimeoutRef.current = window.setTimeout(() => {
      hideTimeoutRef.current = null;
      scrollbar.removeAttribute("data-scrolling");
    }, SCROLLBAR_IDLE_DELAY_MS);
  });
  const sync = useEffectEvent((scrollContainer: HTMLDivElement) => {
    scrollContainerRef.current = scrollContainer;
    const scrollbar = scrollbarRef.current;
    if (!scrollbar) {
      return;
    }

    const geometry = resolveScrollbarGeometry(
      scrollContainer.scrollTop,
      scrollContainer.scrollHeight,
      scrollContainer.clientHeight,
    );

    if (!geometry) {
      clearHideTimeout();
      scrollbar.removeAttribute("data-scrolling");
      return;
    }

    scrollbar.style.height = `${geometry.height}px`;
    scrollbar.style.transform = `translate3d(0, ${geometry.top}px, 0)`;
    scrollbar.setAttribute("data-scrolling", "");

    if (dragRef.current) {
      return;
    }

    scheduleHide(scrollbar);
  });
  const finishDrag = useEffectEvent((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    scheduleHide(event.currentTarget);
  });
  const handlePointerDown = useEffectEvent((event: PointerEvent<HTMLDivElement>) => {
    const scrollContainer = scrollContainerRef.current;
    if (!event.isPrimary || event.button !== 0 || !scrollContainer) {
      return;
    }

    const geometry = resolveScrollbarGeometry(
      scrollContainer.scrollTop,
      scrollContainer.scrollHeight,
      scrollContainer.clientHeight,
    );
    if (
      !geometry ||
      scrollContainer.clientHeight - SCROLLBAR_VERTICAL_INSET * 2 <= geometry.height
    ) {
      return;
    }

    event.preventDefault();
    clearHideTimeout();
    dragRef.current = {
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startScrollTop: scrollContainer.scrollTop,
      scrollHeight: scrollContainer.scrollHeight,
      viewportHeight: scrollContainer.clientHeight,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  });
  const handlePointerMove = useEffectEvent((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const scrollContainer = scrollContainerRef.current;
    if (!drag || event.pointerId !== drag.pointerId || !scrollContainer) {
      return;
    }

    event.preventDefault();
    scrollContainer.scrollTop = resolveScrollbarDragScrollTop(
      drag.startScrollTop,
      event.clientY - drag.startClientY,
      drag.scrollHeight,
      drag.viewportHeight,
    );
    sync(scrollContainer);
  });
  const handleWheel = useEffectEvent((event: WheelEvent<HTMLDivElement>) => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || event.ctrlKey || event.deltaY === 0) {
      return;
    }

    event.preventDefault();
    const deltaScale = event.deltaMode === 1 ? WHEEL_LINE_HEIGHT : scrollContainer.clientHeight;
    scrollContainer.scrollTop += event.deltaMode === 0 ? event.deltaY : event.deltaY * deltaScale;
    sync(scrollContainer);
  });

  useEffect(() => {
    return () => {
      clearHideTimeout();
    };
  }, []);

  return {
    props: {
      "aria-hidden": true,
      className: "documint-scrollbar",
      onLostPointerCapture: finishDrag,
      onPointerCancel: finishDrag,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: finishDrag,
      onWheel: handleWheel,
      ref: scrollbarRef,
    },
    sync,
  };
}

export function resolveScrollbarDragScrollTop(
  startScrollTop: number,
  pointerDelta: number,
  scrollHeight: number,
  viewportHeight: number,
) {
  const geometry = resolveScrollbarGeometry(startScrollTop, scrollHeight, viewportHeight);
  if (!geometry) {
    return 0;
  }

  const maximumScrollTop = scrollHeight - viewportHeight;
  const trackHeight = viewportHeight - SCROLLBAR_VERTICAL_INSET * 2;
  const thumbTravel = trackHeight - geometry.height;
  if (thumbTravel <= 0) {
    return Math.min(Math.max(startScrollTop, 0), maximumScrollTop);
  }

  return Math.min(
    Math.max(startScrollTop + (pointerDelta * maximumScrollTop) / thumbTravel, 0),
    maximumScrollTop,
  );
}

export function resolveScrollbarGeometry(
  scrollTop: number,
  scrollHeight: number,
  viewportHeight: number,
) {
  if (scrollHeight <= viewportHeight) {
    return null;
  }

  const trackHeight = Math.max(0, viewportHeight - SCROLLBAR_VERTICAL_INSET * 2);
  if (trackHeight === 0) {
    return null;
  }

  const height = Math.min(
    trackHeight,
    Math.max(SCROLLBAR_MINIMUM_HEIGHT, (trackHeight * viewportHeight) / scrollHeight),
  );
  const maximumScrollTop = scrollHeight - viewportHeight;
  const progress = Math.min(Math.max(scrollTop, 0), maximumScrollTop) / maximumScrollTop;

  return {
    height,
    top: SCROLLBAR_VERTICAL_INSET + (trackHeight - height) * progress,
  };
}
