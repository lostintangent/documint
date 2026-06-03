import { useEffect } from "react";
import type { DocumintStorage } from "documint";
import type { HostMessage, WebviewMessage } from "../../types";
import { vscode } from "../vscode";

const storage: DocumintStorage = {
  async readFile(filePath) {
    const { data, mimeType } = await sendRequest<"read-result">((id) => ({
      type: "read-path",
      id,
      path: filePath,
    }));

    return data === null
      ? null
      : new Blob([data], {
          type: mimeType ?? "application/octet-stream",
        });
  },
  async writeFile(file) {
    const data = await file.arrayBuffer();
    const { path } = await sendRequest<"write-result">((id) => ({
      type: "write-path",
      id,
      name: file.name,
      data,
    }));

    return path;
  },
  openFile(path) {
    vscode.postMessage({ type: "open-path", path });
  },
};

export function useStorage(): DocumintStorage {
  useEffect(() => {
    const handleMessage = ({ data }: MessageEvent<HostMessage>) => {
      if (!("id" in data)) return;

      const resolveRequest = pendingRequests.get(data.id);
      if (!resolveRequest) return;

      pendingRequests.delete(data.id);
      resolveRequest(data);
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return storage;
}

const pendingRequests = new Map<string, (message: HostMessage) => void>();
let requestSequence = 0;

const sendRequest = <TType extends "read-result" | "write-result">(
  createMessage: (id: string) => Extract<WebviewMessage, { id: string }>,
) =>
  new Promise<Extract<HostMessage, { type: TType }>>((resolve) => {
    const id = String(++requestSequence);
    pendingRequests.set(id, (message) => {
      resolve(message as Extract<HostMessage, { type: TType }>);
    });

    vscode.postMessage(createMessage(id));
  });
