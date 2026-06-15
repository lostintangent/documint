import { serializeDecorations } from "./config";
import type { DocumintDecoration } from "@/types";
import workerSource from "../worker/source";
import type {
  DecorationRootResult,
  DecorationRootSnapshot,
  DecorationWorkerRequest,
  DecorationWorkerResponse,
  SerializedDecoration,
} from "../shared";

const decorationJobTimeoutMs = 2000;

type DecorationWorkerHandle = {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<DecorationWorkerResponse>) => void,
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  postMessage(message: DecorationWorkerRequest): void;
  terminate(): void;
};

type DecorationWorkerClientOptions = {
  createWorker?: () => DecorationWorkerHandle;
  timeoutMs?: number;
};

type PendingDecorationRequest = {
  reject: (error: Error) => void;
  resolve: (result: DecorationResult) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

export class DecorationWorkerDisposedError extends Error {
  constructor() {
    super("Decoration worker disposed.");
    this.name = "DecorationWorkerDisposedError";
  }
}

export function isDecorationWorkerDisposedError(
  error: unknown,
): error is DecorationWorkerDisposedError {
  return error instanceof Error && error.name === "DecorationWorkerDisposedError";
}

export type DecorationRequest = {
  codeGrammars: Record<string, readonly DocumintDecoration[]>;
  configKey: string;
  decorations: readonly DocumintDecoration[];
  roots: DecorationRootSnapshot[];
};

export type DecorationResult = {
  configKey: string;
  roots: DecorationRootResult[];
};

export type DecorationWorkerClient = {
  dispose: () => void;
  run: (request: DecorationRequest) => Promise<DecorationResult>;
};

export function createDecorationWorkerClient(
  options: DecorationWorkerClientOptions = {},
): DecorationWorkerClient {
  const worker = (options.createWorker ?? createDecorationWorker)();
  const timeoutMs = options.timeoutMs ?? decorationJobTimeoutMs;
  let terminated = false;
  let configuredKey: string | null = null;
  let nextRequestId = 1;
  const pending = new Map<number, PendingDecorationRequest>();

  function terminateWithError(error: Error) {
    if (terminated) return;
    terminated = true;
    worker.terminate();

    for (const [requestId, entry] of pending) {
      pending.delete(requestId);
      clearTimeout(entry.timeoutId);
      entry.reject(error);
    }
  }

  worker.addEventListener("message", (event: MessageEvent<DecorationWorkerResponse>) => {
    const response = event.data;
    const entry = pending.get(response.requestId);
    if (!entry) return;

    pending.delete(response.requestId);
    clearTimeout(entry.timeoutId);

    if (response.kind === "decoration-error") {
      entry.reject(new Error(response.message));
      return;
    }

    entry.resolve({
      configKey: response.configKey,
      roots: response.roots,
    });
  });

  worker.addEventListener("error", (event) => {
    terminateWithError(new Error(event.message || "Decoration worker failed."));
  });

  return {
    dispose() {
      terminateWithError(new DecorationWorkerDisposedError());
    },

    run(request) {
      if (terminated) {
        return Promise.reject(new Error("Decoration worker terminated."));
      }

      const requestId = nextRequestId++;
      if (configuredKey !== request.configKey) {
        worker.postMessage({
          kind: "configure-decorations",
          configKey: request.configKey,
          codeGrammars: serializeCodeGrammars(request.codeGrammars),
          decorations: serializeDecorations(request.decorations),
        });
        configuredKey = request.configKey;
      }

      const message: DecorationWorkerRequest = {
        kind: "apply-decorations",
        configKey: request.configKey,
        requestId,
        roots: request.roots,
      };

      return new Promise<DecorationResult>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          // Terminate the worker — a pathological regex can spin forever.
          terminateWithError(new Error("Decoration worker job timed out."));
        }, timeoutMs);

        pending.set(requestId, { reject, resolve, timeoutId });
        worker.postMessage(message);
      });
    },
  };
}

function serializeCodeGrammars(
  grammars: Record<string, readonly DocumintDecoration[]>,
): Record<string, SerializedDecoration[]> {
  const serialized: Record<string, SerializedDecoration[]> = {};
  for (const [language, rules] of Object.entries(grammars)) {
    serialized[language] = serializeDecorations(rules);
  }
  return serialized;
}

function createDecorationWorker(): DecorationWorkerHandle {
  const blob = new Blob([workerSource], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url, { type: "module" });
  URL.revokeObjectURL(url);
  return worker;
}
