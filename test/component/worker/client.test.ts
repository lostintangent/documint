import { describe, expect, test } from "bun:test";
import { createDocument, createParagraphTextBlock } from "@/document";
import {
  createDecorationWorkerClient,
  isDecorationWorkerDisposedError,
  type DecorationWorkerLike,
  type DecorationJobRequest,
} from "@/component/worker/client";
import type {
  DecorationWorkerRequest,
  DecorationWorkerResponse,
} from "@/component/worker/protocol";

describe("DecorationWorkerClient", () => {
  test("returns null when a worker cannot be created", () => {
    expect(createDecorationWorkerClient({ createWorker: () => null })).toBeNull();
  });

  test("resolves matching worker responses", async () => {
    const worker = new FakeDecorationWorker();
    const client = createDecorationWorkerClient({ createWorker: () => worker });
    expect(client).not.toBeNull();
    if (!client) throw new Error("Expected decoration worker client.");
    const promise = client.run(createDecorationRequest());

    expect(worker.messages).toEqual([
      {
        kind: "configure-decorations",
        rules: [{ color: "red", flags: "", source: "\\blist\\b" }],
        rulesKey: "rules",
      },
      {
        kind: "apply-decorations",
        requestId: 1,
        roots: [expect.objectContaining({ rootIndex: 0 })],
        rulesKey: "rules",
      },
    ]);
    worker.emitMessage({
      kind: "decoration-result",
      requestId: 1,
      roots: [],
      rulesKey: "rules",
    });

    expect(await promise).toEqual({ roots: [], rulesKey: "rules" });
  });

  test("sends decoration rules only when the rule key changes", async () => {
    const worker = new FakeDecorationWorker();
    const client = createDecorationWorkerClient({ createWorker: () => worker });
    expect(client).not.toBeNull();
    if (!client) throw new Error("Expected decoration worker client.");

    const first = client.run(createDecorationRequest());
    worker.emitMessage({
      kind: "decoration-result",
      requestId: 1,
      roots: [],
      rulesKey: "rules",
    });
    await first;

    const second = client.run(createDecorationRequest());
    worker.emitMessage({
      kind: "decoration-result",
      requestId: 2,
      roots: [],
      rulesKey: "rules",
    });
    await second;

    expect(worker.messages.map((message) => message.kind)).toEqual([
      "configure-decorations",
      "apply-decorations",
      "apply-decorations",
    ]);
  });

  test("terminates the worker when a job times out", async () => {
    const worker = new FakeDecorationWorker();
    const client = createDecorationWorkerClient({ createWorker: () => worker, timeoutMs: 1 });
    expect(client).not.toBeNull();
    if (!client) throw new Error("Expected decoration worker client.");

    const error = await expectRejected(client.run(createDecorationRequest()));

    expect(error.message).toContain("timed out");
    expect(worker.terminated).toBe(true);

    const nextError = await expectRejected(client.run(createDecorationRequest()));
    expect(nextError.message).toContain("terminated");
  });

  test("settles pending jobs with a disposal error when disposed", async () => {
    const worker = new FakeDecorationWorker();
    const client = createDecorationWorkerClient({ createWorker: () => worker });
    expect(client).not.toBeNull();
    if (!client) throw new Error("Expected decoration worker client.");
    const promise = client.run(createDecorationRequest());

    client.dispose();
    const error = await expectRejected(promise);

    expect(isDecorationWorkerDisposedError(error)).toBe(true);
    expect(worker.terminated).toBe(true);
  });
});

class FakeDecorationWorker implements DecorationWorkerLike {
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

function createDecorationRequest(): DecorationJobRequest {
  const document = createDocument([createParagraphTextBlock("A list item")]);

  return {
    roots: [{ block: document.blocks[0]!, rootIndex: 0, sourceKey: "source" }],
    rules: [{ color: "red", pattern: /\blist\b/ }],
    rulesKey: "rules",
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
