// Anchor measurement for textareas. Resolves a viewport-space anchor for a
// given character index in the textarea — useful for placing autocomplete
// popovers, mention menus, and any other UI that should sit just below
// where a specific character renders. Browsers don't expose this directly,
// so we mirror the textarea's rendering into an offscreen <div>, place a
// marker <span> at the requested index, and translate the marker's box
// into viewport coordinates.

const MIRRORED_PROPERTIES = [
  "box-sizing",
  "width",
  "height",
  "overflow-x",
  "overflow-y",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-style",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font-style",
  "font-variant",
  "font-weight",
  "font-stretch",
  "font-size",
  "font-size-adjust",
  "line-height",
  "font-family",
  "text-align",
  "text-transform",
  "text-indent",
  "text-decoration",
  "letter-spacing",
  "word-spacing",
  "tab-size",
];

export type TextareaAnchor = {
  /** Anchor x in viewport coordinates, aligned to the character's left edge. */
  left: number;
  /** Anchor y in viewport coordinates, set to the bottom of the character's
   *  line plus `topGap` so UI positioned here sits just below the character
   *  with a small breathing-room offset. */
  top: number;
};

export type ResolveTextareaAnchorOptions = {
  /** Pixels to add below the cursor line so anchored UI doesn't visually
   *  touch it. Defaults to 8. Pass 0 to anchor flush against the line. */
  topGap?: number;
};

export function resolveTextareaAnchor(
  textarea: HTMLTextAreaElement,
  index: number,
  { topGap = 8 }: ResolveTextareaAnchorOptions = {},
): TextareaAnchor | null {
  if (!textarea.isConnected) return null;

  const computed = getComputedStyle(textarea);
  const mirror = document.createElement("div");

  for (const prop of MIRRORED_PROPERTIES) {
    mirror.style.setProperty(prop, computed.getPropertyValue(prop));
  }
  Object.assign(mirror.style, {
    position: "absolute",
    top: "0",
    left: "0",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
    wordWrap: "break-word",
    // Pin to the textarea's actual rendered width so wrapping doesn't shift
    // when the source uses auto/percentage widths.
    width: `${textarea.clientWidth}px`,
  });

  mirror.textContent = textarea.value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(index) || ".";
  mirror.appendChild(marker);

  document.body.appendChild(mirror);

  // Translate the marker's box into viewport coordinates: lift to the
  // textarea's outer edge by adding border widths, drop to the line's
  // bottom by adding line height (+ topGap for breathing room), subtract
  // the textarea's internal scroll, then add the textarea's viewport
  // position.
  const rect = textarea.getBoundingClientRect();
  const lineHeight = parseFloat(computed.lineHeight) || marker.offsetHeight;
  const anchor: TextareaAnchor = {
    left:
      rect.left +
      marker.offsetLeft +
      parseFloat(computed.borderLeftWidth) -
      textarea.scrollLeft,
    top:
      rect.top +
      marker.offsetTop +
      parseFloat(computed.borderTopWidth) +
      lineHeight +
      topGap -
      textarea.scrollTop,
  };

  document.body.removeChild(mirror);

  return anchor;
}
