import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { KeybindingPlayground } from "./KeybindingPlayground";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element for the keybinding playground.");
}

createRoot(rootElement).render(
  <StrictMode>
    <KeybindingPlayground />
  </StrictMode>,
);
