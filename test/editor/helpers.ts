// Setup and selection primitives shared by every subsystem under
// `test/editor/`. Crosses the markdown ↔ document ↔ editor seam.

import {
  createDocumentFromEditorState,
  createEditorState,
  setSelection,
  type EditorRegion,
  type EditorState,
} from "@/editor/state";
import { parseDocument, serializeDocument } from "@/markdown";

/** Create an editor state from a markdown string. */
export function setup(markdown: string): EditorState {
  return createEditorState(parseDocument(markdown));
}

/** Serialize an editor state back to a markdown string. */
export function toMarkdown(state: EditorState): string {
  return serializeDocument(createDocumentFromEditorState(state));
}

/**
 * Find a region by its plain-text content. Throws if not found.
 * Pass an empty string to find the first empty region.
 */
export function getRegion(state: EditorState, text: string): EditorRegion {
  const region = state.documentIndex.regions.find((r) => r.text === text);

  if (!region) {
    throw new Error(`Expected region with text "${text}"`);
  }

  return region;
}

/**
 * Find the first region of a given block type. Used when a fixture has a
 * single block of a particular kind (heading, code block, etc.) and the
 * test wants to locate it independent of its content.
 */
export function getRegionByType(state: EditorState, blockType: string): EditorRegion {
  const region = state.documentIndex.regions.find((r) => r.blockType === blockType);

  if (!region) {
    throw new Error(`Expected region with block type "${blockType}"`);
  }

  return region;
}

/**
 * Place a collapsed caret at the given offset in a region.
 * Pass "start" for 0 or "end" for text.length.
 */
export function placeAt(
  state: EditorState,
  region: EditorRegion,
  offset: number | "start" | "end",
): EditorState {
  const resolvedOffset =
    offset === "start" ? 0 : offset === "end" ? region.text.length : offset;

  return setSelection(state, { regionId: region.id, offset: resolvedOffset });
}

/**
 * Expand the selection to a character range within a single region.
 * start and end are offsets into region.text.
 */
export function selectIn(
  state: EditorState,
  region: EditorRegion,
  start: number,
  end: number,
): EditorState {
  return setSelection(state, {
    anchor: { regionId: region.id, offset: start },
    focus: { regionId: region.id, offset: end },
  });
}

/**
 * Select a substring within a region by value.
 * selectSubstring(state, region, "world") selects the first occurrence of "world".
 */
export function selectSubstring(
  state: EditorState,
  region: EditorRegion,
  substring: string,
): EditorState {
  const start = region.text.indexOf(substring);

  if (start === -1) {
    throw new Error(`"${substring}" not found in region text "${region.text}"`);
  }

  return selectIn(state, region, start, start + substring.length);
}
