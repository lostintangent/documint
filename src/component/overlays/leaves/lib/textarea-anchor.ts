// Anchor measurement for textareas. Resolves a document-absolute anchor for
// a given character index in the textarea — useful for placing autocomplete
// popovers, mention menus, and any other UI that should sit just below
// where a specific character renders. Browsers don't expose this directly,
// so we mirror the textarea's rendering into an offscreen <div>, place a
// marker <span> at the requested index, and translate the marker's box
// into document coordinates.

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
  /** Text line height at the anchor row. */
  anchorHeight: number;
  /** Anchor x in document coordinates, aligned to the character's left edge. */
  left: number;
  /** Anchor y in document coordinates, set to the bottom of the character's line. */
  top: number;
};

export type ResolveTextareaAnchorOptions = {
  /** Document-page x scroll to add to viewport-space textarea geometry. */
  scrollX?: number;
  /** Document-page y scroll to add to viewport-space textarea geometry. */
  scrollY?: number;
};

export function resolveTextareaAnchor(
  textarea: HTMLTextAreaElement,
  index: number,
  { scrollX = window.scrollX, scrollY = window.scrollY }: ResolveTextareaAnchorOptions = {},
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

  // Translate the marker's box into document coordinates: lift to the
  // textarea's outer edge by adding border widths, drop to the line's
  // bottom by adding line height, subtract the textarea's internal scroll,
  // then add the textarea's viewport position and document-page scroll.
  const rect = textarea.getBoundingClientRect();
  const lineHeight = parseFloat(computed.lineHeight) || marker.offsetHeight;
  const anchor: TextareaAnchor = {
    anchorHeight: lineHeight,
    left:
      scrollX +
      rect.left +
      marker.offsetLeft +
      parseFloat(computed.borderLeftWidth) -
      textarea.scrollLeft,
    top:
      scrollY +
      rect.top +
      marker.offsetTop +
      parseFloat(computed.borderTopWidth) +
      lineHeight -
      textarea.scrollTop,
  };

  document.body.removeChild(mirror);

  return anchor;
}
