import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Playground } from "./Playground";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element for the playground.");
}

// Disable iOS Safari's pinch-to-zoom without affecting single/double-tap
// gestures (which iOS uses for text selection etc.). `touch-action` in CSS
// is too coarse — `pan-x pan-y` would suppress double-tap too — so use the
// proprietary `gesture*` events, which only fire for pinch / rotate.
const prevent = (event: Event) => event.preventDefault();
document.addEventListener("gesturestart", prevent);
document.addEventListener("gesturechange", prevent);
document.addEventListener("gestureend", prevent);

createRoot(rootElement).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
);
