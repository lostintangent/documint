import { expect, test } from "bun:test";
import { createCaretBlink } from "@/component/hooks/useCursor";

test("stops blinking and repainting the caret once the editor blurs", () => {
  const timers = new Set<() => void>();
  const blink = createCaretBlink((toggle) => {
    timers.add(toggle);
    return () => timers.delete(toggle);
  });
  let paints = 0;
  blink.subscribe(() => paints++);

  const stopBlink = blink.sync(true, true);
  expect(timers.size).toBe(1);

  // React runs the previous effect's cleanup before the next sync. The editor
  // blurs mid-keystroke, then the activity clock settles.
  stopBlink?.();
  blink.sync(false, false);
  blink.sync(false, true);

  expect(timers.size).toBe(0);
  expect(blink.isVisible()).toBe(false);
  expect(paints).toBe(2);
});
