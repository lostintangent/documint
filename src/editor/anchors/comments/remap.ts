/**
 * Edit-time anchor remap.
 *
 * The complement to content-addressable resolution. When a known edit
 * happens — we know exactly where, what was deleted, and what was inserted
 * — we don't need to re-search by fingerprint. We can translate offsets
 * directly through the splice math. Cheaper, and avoids the fingerprint
 * drift problem that hits when an edit lands inside the prefix or suffix.
 *
 * Used by consumers whose anchors live at character offsets and want to
 * stay sticky across local edits without paying the cost of a full algebra
 * resolve every keystroke.
 */

// Translate a stable `(start, end)` range through a text edit at
// `(editStart, editEnd)` that inserted `insertedLength` characters.
//
// Cases:
//   - Edit ends before the range starts: shift both endpoints by the delta.
//   - Edit starts at or after the range ends: range is untouched.
//   - Edit overlaps the range: preserve the surviving prefix and suffix
//     around the inserted text.
export function remapEditedRange(
  start: number,
  end: number,
  editStart: number,
  editEnd: number,
  insertedLength: number,
): { start: number; end: number } {
  const deletedLength = editEnd - editStart;
  const delta = insertedLength - deletedLength;

  if (editEnd <= start) {
    return {
      end: end + delta,
      start: start + delta,
    };
  }

  if (editStart >= end) {
    return {
      end,
      start,
    };
  }

  const preservedPrefixLength = Math.max(0, Math.min(editStart, end) - start);
  const preservedSuffixLength = Math.max(0, end - Math.max(editEnd, start));
  const nextStart = start < editStart ? start : editStart;
  const nextEnd = nextStart + preservedPrefixLength + insertedLength + preservedSuffixLength;

  return {
    end: nextEnd,
    start: nextStart,
  };
}
