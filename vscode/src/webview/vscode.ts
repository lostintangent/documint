import type { WebviewMessage } from "../types";

export type VsCodeApi = {
  postMessage(message: WebviewMessage): void;
};

declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();
