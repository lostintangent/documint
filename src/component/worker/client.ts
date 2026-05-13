import { serializeDecorationRules, type DocumintDecoration } from "../decorations/rules";
import workerSource from "./source";
import type {
  DecorationRootResult,
  DecorationRootSnapshot,
  DecorationWorkerRequest,
  DecorationWorkerResponse,
} from "./protocol";
import { emitDiagnostic } from "../lib/diagnostics";

const decorationJobTimeoutMs = 2000;

export type DecorationWorkerLike = {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<DecorationWorkerResponse>) => void,
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  postMessage(message: DecorationWorkerRequest): void;
  terminate(): void;
};

export type DecorationWorkerClientOptions = {
  createWorker?: () => DecorationWorkerLike | null;
  timeoutMs?: number;
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

export type DecorationJobRequest = {
  roots: DecorationRootSnapshot[];
  rules: readonly DocumintDecoration[];
  rulesKey: string;
};

export type DecorationJobResult = {
  roots: DecorationRootResult[];
  rulesKey: string;
};

export type DecorationWorkerClient = {
  dispose: () => void;
  run: (request: DecorationJobRequest) => Promise<DecorationJobResult>;
};

export function createDecorationWorkerClient(
  options: DecorationWorkerClientOptions = {},
): DecorationWorkerClient | null {
  const maybeWorker = (options.createWorker ?? createDecorationWorker)();

  if (!maybeWorker) {
    return null;
  }

  const worker = maybeWorker;
  const timeoutMs = options.timeoutMs ?? decorationJobTimeoutMs;
  let terminated = false;
  let configuredRulesKey = "";
  let nextRequestId = 1;
  const pending = new Map<
    number,
    {
      reject: (error: Error) => void;
      resolve: (result: DecorationJobResult) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }
  >();

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
      roots: response.roots,
      rulesKey: response.rulesKey,
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
      if (configuredRulesKey !== request.rulesKey) {
        worker.postMessage({
          kind: "configure-decorations",
          rules: serializeDecorationRules(request.rules),
          rulesKey: request.rulesKey,
        });
        configuredRulesKey = request.rulesKey;
      }

      const message: DecorationWorkerRequest = {
        kind: "apply-decorations",
        requestId,
        roots: request.roots,
        rulesKey: request.rulesKey,
      };

      return new Promise<DecorationJobResult>((resolve, reject) => {
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

function createDecorationWorker(): DecorationWorkerLike | null {
  if (
    typeof Worker === "undefined" ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    workerSource.trim().length === 0
  ) {
    if (process.env.NODE_ENV !== "production") {
      emitDiagnostic("decorationWorkerFallback", {
        reason: workerSource.trim().length === 0 ? "missing-worker-source" : "unsupported-runtime",
      });
    }
    return null;
  }

  try {
    const blob = new Blob([workerSource], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url, { type: "module" });
    URL.revokeObjectURL(url);
    return worker;
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      emitDiagnostic("decorationWorkerFallback", {
        message: error instanceof Error ? error.message : String(error),
        reason: "construction-failed",
      });
    }
    return null;
  }
}
