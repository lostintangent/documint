import type { DocumintStorage } from "@lostintangent/documint";
import type { HostMessage, WebviewMessage } from "../types";
import { vscode } from "./vscode";

export const storage: DocumintStorage = {
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

const pendingRequests = new Map<string, (message: HostMessage) => void>();
let requestSequence = 0;

// The webview lives as long as this module, so the response listener never
// needs removing.
window.addEventListener("message", ({ data }: MessageEvent<HostMessage>) => {
  if (!("id" in data)) return;

  const resolveRequest = pendingRequests.get(data.id);
  if (!resolveRequest) return;

  pendingRequests.delete(data.id);
  resolveRequest(data);
});

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
