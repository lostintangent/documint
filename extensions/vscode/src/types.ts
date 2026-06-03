// Host -> webview communication
export type HostMessage =
  | { type: "set-content"; content: string }
  | {
      type: "read-result";
      id: string;
      data: ArrayBuffer | null;
      mimeType?: string;
    }
  | { type: "write-result"; id: string; path: string };

// Webview -> host communication
export type WebviewMessage =
  | { type: "ready" }
  | { type: "edit-content"; content: string }
  | { type: "read-path"; id: string; path: string }
  | { type: "write-path"; id: string; name: string; data: ArrayBuffer }
  | { type: "open-path"; path: string };
