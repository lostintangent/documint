import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Playground } from "./Playground";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element for the playground.");
}

createRoot(rootElement).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
);
