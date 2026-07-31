import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Documint } from "@lostintangent/documint";
import type { HostMessage } from "../types";

import { useStorage } from "./hooks/useStorage";
import { useTheme } from "./hooks/useTheme";
import { vscode } from "./vscode";

const users = [{ id: "copilot", username: "copilot", fullName: "Copilot" }];

function App() {
  const [content, setContent] = useState<string | null>(null);

  const storage = useStorage();
  const theme = useTheme();

  useEffect(() => {
    const handleMessage = ({ data }: MessageEvent<HostMessage>) => {
      if (data.type === "set-content") {
        setContent(data.content);
      }
    };

    window.addEventListener("message", handleMessage);
    vscode.postMessage({ type: "ready" });

    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleContentChanged = (nextContent: string) => {
    vscode.postMessage({ type: "edit-content", content: nextContent });
  };

  if (content === null) return null;

  return (
    <Documint
      content={content}
      onContentChanged={handleContentChanged}
      storage={storage}
      theme={theme}
      users={users}
    />
  );
}

const rootElement = document.getElementById("root");
createRoot(rootElement!).render(<App />);
