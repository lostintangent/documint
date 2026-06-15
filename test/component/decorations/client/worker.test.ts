import { describe, expect, test } from "bun:test";
import { createDocument, createParagraphTextBlock } from "@/document";
import {
  createDecorationWorkerClient,
  isDecorationWorkerDisposedError,
  type DecorationRequest,
} from "@/component/decorations/client/worker";
import type {
  DecorationWorkerRequest,
  DecorationWorkerResponse,
} from "@/component/decorations/shared";

describe("DecorationWorkerClient", () => {
  test("resolves matching worker responses", async () => {
    const worker = new FakeDecorationWorker();
    const client = createDecorationWorkerClient({ createWorker: () => worker });
    const promise = client.run(createDecorationRequest());

    expect(worker.messages).toEqual([
      {
        kind: "configure-decorations",
        configKey: "decorations",
        codeGrammars: {},
        decorations: [{ color: "red", flags: "", source: "\\blist\\b" }],
      },
      {
        kind: "apply-decorations",
        configKey: "decorations",
        requestId: 1,
        roots: [expect.objectContaining({ rootIndex: 0 })],
      },
    ]);
    worker.emitMessage({
      kind: "decoration-result",
      configKey: "decorations",
      requestId: 1,
      roots: [],
    });

    expect(await promise).toEqual({ configKey: "decorations", roots: [] });
  });

  test("serializes code grammars with the decoration config", async () => {
    const worker = new FakeDecorationWorker();
    const client = createDecorationWorkerClient({ createWorker: () => worker });

    const promise = client.run({
      ...createDecorationRequest(),
      codeGrammars: {
        tree: [
          { color: "green", pattern: /&+/ },
          { backgroundColor: "gold", pulse: true, pattern: /_+/ },
        ],
      },
    });

    expect(worker.messages[0]).toEqual({
      kind: "configure-decorations",
      configKey: "decorations",
      codeGrammars: {
        tree: [
          { color: "green", flags: "", source: "&+" },
          { backgroundColor: "gold", pulse: true, flags: "", source: "_+" },
        ],
      },
      decorations: [{ color: "red", flags: "", source: "\\blist\\b" }],
    });

    worker.emitMessage({
      kind: "decoration-result",
      configKey: "decorations",
      requestId: 1,
      roots: [],
    });
    await promise;
  });

  test("sends decoration config only when the config key changes", async () => {
    const worker = new FakeDecorationWorker();
    const client = createDecorationWorkerClient({ createWorker: () => worker });

    const first = client.run(createDecorationRequest());
    worker.emitMessage({
      kind: "decoration-result",
      configKey: "decorations",
      requestId: 1,
      roots: [],
    });
    await first;

    const second = client.run(createDecorationRequest());
    worker.emitMessage({
      kind: "decoration-result",
      configKey: "decorations",
      requestId: 2,
      roots: [],
    });
    await second;

    expect(worker.messages.map((message) => message.kind)).toEqual([
      "configure-decorations",
      "apply-decorations",
      "apply-decorations",
    ]);
  });

  test("sends decoration config for the first request even when the config key is empty", async () => {
    const worker = new FakeDecorationWorker();
    const client = createDecorationWorkerClient({ createWorker: () => worker });
    const promise = client.run({ ...createDecorationRequest(), configKey: "" });

    worker.emitMessage({
      kind: "decoration-result",
      configKey: "",
      requestId: 1,
      roots: [],
    });
    await promise;

    expect(worker.messages.map((message) => message.kind)).toEqual([
      "configure-decorations",
      "apply-decorations",
    ]);
  });

  test("terminates the worker when a job times out", async () => {
    const worker = new FakeDecorationWorker();
    const client = createDecorationWorkerClient({ createWorker: () => worker, timeoutMs: 1 });

    const error = await expectRejected(client.run(createDecorationRequest()));

    expect(error.message).toContain("timed out");
    expect(worker.terminated).toBe(true);

    const nextError = await expectRejected(client.run(createDecorationRequest()));
    expect(nextError.message).toContain("terminated");
  });

  test("settles pending jobs with a disposal error when disposed", async () => {
    const worker = new FakeDecorationWorker();
    const client = createDecorationWorkerClient({ createWorker: () => worker });
    const promise = client.run(createDecorationRequest());

    client.dispose();
    const error = await expectRejected(promise);

    expect(isDecorationWorkerDisposedError(error)).toBe(true);
    expect(worker.terminated).toBe(true);
  });
});

class FakeDecorationWorker {
  readonly messages: DecorationWorkerRequest[] = [];
  private readonly messageListeners: Array<
    (event: MessageEvent<DecorationWorkerResponse>) => void
  > = [];
  private readonly errorListeners: Array<(event: ErrorEvent) => void> = [];
  terminated = false;

  addEventListener(
    type: "message",
    listener: (event: MessageEvent<DecorationWorkerResponse>) => void,
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(
    type: "message" | "error",
    listener:
      | ((event: MessageEvent<DecorationWorkerResponse>) => void)
      | ((event: ErrorEvent) => void),
  ) {
    if (type === "message") {
      this.messageListeners.push(
        listener as (event: MessageEvent<DecorationWorkerResponse>) => void,
      );
    } else {
      this.errorListeners.push(listener as (event: ErrorEvent) => void);
    }
  }

  postMessage(message: DecorationWorkerRequest) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emitMessage(response: DecorationWorkerResponse) {
    for (const listener of this.messageListeners) {
      listener({ data: response } as MessageEvent<DecorationWorkerResponse>);
    }
  }
}

function createDecorationRequest(): DecorationRequest {
  const document = createDocument([createParagraphTextBlock("A list item")]);

  return {
    codeGrammars: {},
    configKey: "decorations",
    decorations: [{ color: "red", pattern: /\blist\b/ }],
    roots: [{ block: document.blocks[0]!, rootIndex: 0, sourceKey: "source" }],
  };
}

async function expectRejected(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`Expected Error rejection, received ${String(error)}`);
  }

  throw new Error("Expected promise to reject.");
}
