import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { approveAll, CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import { randomUUID } from "node:crypto";
import { existsSync, watch } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const artifactDir = join(extensionDir, "artifacts");
const appBundlePath = join(extensionDir, "dist", "app.js");
const canvasTitle = "Documint";
const copilotUserId = "copilot";
const defaultMarkdown = `# Documint Copilot canvas

Select text, add a comment, and mention @Copilot to ask the agent to edit this file.
`;
const requestBodyLimitBytes = 25 * 1024 * 1024;

let session;
let childClientPromise;
let server;
let serverOrigin;

const canvasInstances = new Map();
const documents = new Map();
const subscribers = new Map();
const documentWatchers = new Map();
const documentRefreshTimers = new Map();
const activeCopilotJobs = new Map();

const markdownCanvas = createCanvas({
  id: "documint-markdown-agent",
  displayName: canvasTitle,
  description: "Edit a markdown file with Documint and let Copilot respond to @Copilot comment mentions.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Markdown file path to edit. Relative paths resolve from the session working directory.",
      },
      content: {
        type: "string",
        description: "Initial content to use only when the target markdown file does not exist.",
      },
      title: {
        type: "string",
        description: "Optional panel title.",
      },
    },
    additionalProperties: false,
  },
  actions: [
    {
      name: "get_markdown",
      description: "Return the current markdown content and backing file path for this canvas.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: handleGetMarkdownAction,
    },
    {
      name: "update_markdown",
      description: "Replace the backing markdown file content and refresh the Documint canvas.",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "The full markdown content to write." },
        },
        required: ["content"],
        additionalProperties: false,
      },
      handler: handleUpdateMarkdownAction,
    },
    {
      name: "run_copilot",
      description: "Ask Copilot to edit the markdown file for this canvas using the supplied instructions.",
      inputSchema: {
        type: "object",
        properties: {
          instructions: { type: "string", description: "What Copilot should change in the markdown file." },
        },
        required: ["instructions"],
        additionalProperties: false,
      },
      handler: handleRunCopilotAction,
    },
  ],
  open: handleOpenCanvas,
  onClose: handleCloseCanvas,
});

const httpRouteHandlers = new Map([
  /* Static assets */
  ["GET /", handleAppShellRequest],
  ["GET /assets/app.js", handleAppBundleRequest],

  /* API endpoints */
  ["PUT /api/content", handlePutContentRequest],

  ["GET /api/storage", handleGetStorageRequest],
  ["POST /api/storage", handlePostStorageRequest],
  
  ["POST /api/copilot-comment", handlePostCopilotCommentRequest],
  ["POST /api/copilot-user-mention", handlePostCopilotUserMentionRequest],

  /* SSE */
  ["GET /events", handleEventsRequest],
]);

session = await joinSession({ canvases: [markdownCanvas] });
await session.log("Documint markdown agent canvas loaded.");

async function handleGetMarkdownAction({ instanceId }) {
  const document = getDocumentForInstance(instanceId);
  await refreshDocumentFromDisk(document);
  return toClientState(document);
}

async function handleUpdateMarkdownAction({ instanceId, input }) {
  const document = getDocumentForInstance(instanceId);
  const { content } = readInputObject(input);
  if (typeof content !== "string") {
    throw new CanvasError("invalid_content", "update_markdown requires a string content field.");
  }

  await writeDocumentContent(document, content, "agent-action");
  return { path: document.filePath, bytes: Buffer.byteLength(content, "utf8") };
}

function handleRunCopilotAction({ instanceId, input }) {
  const document = getDocumentForInstance(instanceId);
  const { instructions } = readInputObject(input);
  if (typeof instructions !== "string" || instructions.trim() === "") {
    throw new CanvasError("invalid_instructions", "run_copilot requires non-empty instructions.");
  }

  const job = startCopilotJob(document, {
    body: instructions,
    source: "action",
    threadId: null,
  });
  return jobSummary(job);
}

async function handleOpenCanvas({ instanceId, input }) {
  if (!existsSync(appBundlePath)) {
    throw new CanvasError(
      "app_not_built",
      "The Documint canvas app is not built. Run `bun run build` in the extension directory.",
    );
  }

  const document = await openDocument(readInputObject(input));
  canvasInstances.set(instanceId, document.key);
  ensureWatcher(document);

  const origin = await ensureServer();
  return {
    url: `${origin}/?instanceId=${encodeURIComponent(instanceId)}`,
    title: document.title,
    status: shortPath(document.filePath),
  };
}

function handleCloseCanvas({ instanceId }) {
  canvasInstances.delete(instanceId);
}

function readInputObject(value) {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new CanvasError("invalid_input", "Expected an object input.");
  }
  return value;
}

async function openDocument(input) {
  const filePath = resolveMarkdownPath(input.path);
  const title = readDocumentTitle(input);
  const key = filePath;
  await mkdir(dirname(filePath), { recursive: true });
  const { content, updatedAt } = await readOrCreateDocumentFile(filePath, input);
  const existing = documents.get(key);

  if (existing) {
    existing.title = title;
    if (content !== existing.content) {
      existing.content = content;
      existing.revision += 1;
    }
    existing.updatedAt = updatedAt;
    return existing;
  }

  const document = {
    key,
    filePath,
    title,
    content,
    revision: 1,
    updatedAt,
    lastJob: null,
  };
  documents.set(key, document);
  return document;
}

async function readOrCreateDocumentFile(filePath, input) {
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    content = typeof input.content === "string" ? input.content : defaultMarkdown;
    await writeFile(filePath, content, "utf8");
  }

  const stats = await stat(filePath);
  return {
    content,
    updatedAt: stats.mtime.toISOString(),
  };
}

function readDocumentTitle(input) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  return title || canvasTitle;
}

function resolveMarkdownPath(inputPath) {
  const filePath =
    typeof inputPath === "string" && inputPath.trim()
      ? isAbsolute(inputPath)
        ? resolve(inputPath)
        : resolve(process.cwd(), inputPath)
      : defaultMarkdownPath();

  const extension = extname(filePath).toLowerCase();
  if (extension !== ".md" && extension !== ".markdown") {
    throw new CanvasError("not_markdown", "The Documint canvas can only edit .md or .markdown files.");
  }
  return filePath;
}

function defaultMarkdownPath() {
  const workspacePath = session?.workspacePath;
  if (workspacePath) {
    return join(workspacePath, "files", "documint-canvas.md");
  }
  return join(artifactDir, "documint-canvas.md");
}

function getDocumentForInstance(instanceId) {
  const key = canvasInstances.get(instanceId);
  if (!key) {
    throw new CanvasError("unknown_instance", `No markdown document is open for instance ${instanceId}.`);
  }
  const document = documents.get(key);
  if (!document) {
    throw new CanvasError("unknown_document", `No markdown document is loaded for instance ${instanceId}.`);
  }
  return document;
}

async function refreshDocumentFromDisk(document, source = "disk") {
  const content = await readFile(document.filePath, "utf8");
  const stats = await stat(document.filePath);
  const updatedAt = stats.mtime.toISOString();
  if (content === document.content) {
    document.updatedAt = updatedAt;
    return document;
  }

  document.content = content;
  document.revision += 1;
  document.updatedAt = updatedAt;
  broadcast(document.key, contentEvent(document, source));
  return document;
}

async function writeDocumentContent(document, content, source, metadata = {}, broadcastOptions = {}) {
  await mkdir(dirname(document.filePath), { recursive: true });
  await writeFile(document.filePath, content, "utf8");
  const stats = await stat(document.filePath);
  document.content = content;
  document.revision += 1;
  document.updatedAt = stats.mtime.toISOString();
  broadcast(document.key, contentEvent(document, source, metadata), broadcastOptions);
  return toClientState(document);
}

function ensureWatcher(document) {
  if (documentWatchers.has(document.key)) {
    return;
  }

  const watcher = watch(document.filePath, { persistent: false }, () => {
    clearTimeout(documentRefreshTimers.get(document.key));
    documentRefreshTimers.set(
      document.key,
      setTimeout(async () => {
        try {
          await refreshDocumentFromDisk(document, activeJobsForDocument(document.key).length > 0 ? "copilot" : "disk");
        } catch (error) {
          broadcast(document.key, {
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }, 100),
    );
  });

  watcher.on("error", (error) => {
    broadcast(document.key, { type: "error", message: error.message });
  });
  documentWatchers.set(document.key, watcher);
}

async function ensureServer() {
  if (serverOrigin) {
    return serverOrigin;
  }

  server = createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      sendJson(response, error instanceof CanvasError ? 400 : 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new CanvasError("server_unavailable", "Unable to resolve the loopback canvas server port.");
  }
  serverOrigin = `http://127.0.0.1:${address.port}`;
  return serverOrigin;
}

async function handleRequest(request, response) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const handler = httpRouteHandlers.get(`${request.method ?? ""} ${url.pathname}`);
  if (handler) {
    await handler({ request, response, url });
    return;
  }

  sendJson(response, 404, { error: "Not found." });
}

function handleAppShellRequest({ response }) {
  sendHtml(response);
}

async function handleAppBundleRequest({ response }) {
  await sendFile(response, appBundlePath, "text/javascript; charset=utf-8");
}

async function handlePutContentRequest({ request, response, url }) {
  const document = getRequestDocument(url);
  const body = await readJson(request);

  if (typeof body.content !== "string") {
    sendJson(response, 400, { error: "Expected a string content field." });
    return;
  }

  if ((await readFile(document.filePath, "utf8")) !== document.content) {
    await refreshDocumentFromDisk(document);
    sendJson(response, 409, {
      error: "The file changed on disk before this save could be applied.",
      state: toClientState(document),
    });
    return;
  }

  const clientId = typeof body.clientId === "string" ? body.clientId : undefined;
  const state = await writeDocumentContent(
    document,
    body.content,
    "iframe",
    {
      clientId,
    },
    clientId ? { skipClientId: clientId } : {},
  );
  sendJson(response, 200, state);
}

async function handleGetStorageRequest({ response, url }) {
  const document = getRequestDocument(url);
  const assetPath = url.searchParams.get("path");
  if (!assetPath) {
    sendJson(response, 400, { error: "Missing storage path." });
    return;
  }

  await sendStorageFile(response, document, assetPath);
}

async function handlePostStorageRequest({ request, response, url }) {
  const document = getRequestDocument(url);
  const result = await writeStorageFile(document, request);
  sendJson(response, 200, result);
}

async function handlePostCopilotCommentRequest({ request, response, url }) {
  const document = getRequestDocument(url);
  const body = await readJson(request);
  const job = handleCopilotMention(document, body);
  sendJson(response, 202, jobSummary(job));
}

async function handlePostCopilotUserMentionRequest({ request, response, url }) {
  const document = getRequestDocument(url);
  const body = await readJson(request);
  const job = handleCopilotUserMention(document, body);
  sendJson(response, 202, jobSummary(job));
}

async function handleEventsRequest({ response, url }) {
  const document = getRequestDocument(url);
  try {
    await refreshDocumentFromDisk(document);
  } catch (error) {
    // A transient read/stat failure here (e.g. a concurrent Copilot write to
    // the same file) must not surface as a non-2xx response: the browser
    // EventSource transitions to CLOSED on non-2xx with no auto-reconnect,
    // which permanently silences presence and content events for this canvas
    // until it is reopened. Fall back to the cached document; the watcher
    // will pick up the next successful refresh.
    await session.log(
      `Documint /events refresh failed for ${document.key}; serving cached state: ${error instanceof Error ? error.message : String(error)}`,
      { level: "error" },
    );
  }
  subscribe(document, response, url.searchParams.get("clientId"));
}

function getRequestDocument(url) {
  const instanceId = url.searchParams.get("instanceId");
  if (!instanceId) {
    throw new CanvasError("missing_instance", "Missing instanceId.");
  }
  return getDocumentForInstance(instanceId);
}

function handleCopilotMention(document, body) {
  const mentionedUserIds = Array.isArray(body.mentionedUserIds) ? body.mentionedUserIds : [];
  const commentBody = typeof body.body === "string" ? body.body : "";
  const mentionsCopilot =
    mentionedUserIds.includes(copilotUserId) ||
    mentionsCopilotUser(commentBody) ||
    threadMentionsCopilot(body.thread);

  if (!mentionsCopilot) {
    throw new CanvasError("copilot_not_mentioned", "The comment thread does not mention Copilot.");
  }

  return startCopilotJob(document, {
    body: commentBody,
    source: body.source === "reply" ? "reply" : "comment",
    thread: body.thread && typeof body.thread === "object" ? body.thread : null,
    threadId: typeof body.threadId === "string" ? body.threadId : null,
    trigger: readCommentTrigger(body.trigger),
  });
}

function threadMentionsCopilot(thread) {
  if (!thread || typeof thread !== "object" || !Array.isArray(thread.comments)) {
    return false;
  }
  return thread.comments.some((comment) => mentionsCopilotUser(comment?.body));
}

function mentionsCopilotUser(body) {
  return /(^|[^\w-])@copilot\b/i.test(body ?? "");
}

function handleCopilotUserMention(document, body) {
  const lineMarkdown = typeof body.lineMarkdown === "string" ? body.lineMarkdown : "";
  const lineNumber = Number.isInteger(body.lineNumber) ? body.lineNumber : null;
  const userId = typeof body.userId === "string" ? body.userId : null;

  if (userId !== copilotUserId && !mentionsCopilotUser(lineMarkdown)) {
    throw new CanvasError("copilot_not_mentioned", "The document mention does not target Copilot.");
  }

  return startCopilotJob(document, {
    body: lineMarkdown,
    cursor: readTextAnchor(body.cursor),
    lineMarkdown,
    lineNumber,
    source: "user-mention",
    threadId: null,
    trigger: "document-mention",
  });
}

function readTextAnchor(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const anchor = {};
  if (value.kind === "code" || value.kind === "tableCell" || value.kind === "text") {
    anchor.kind = value.kind;
  }
  if (typeof value.prefix === "string" && value.prefix) {
    anchor.prefix = value.prefix;
  }
  if (typeof value.suffix === "string" && value.suffix) {
    anchor.suffix = value.suffix;
  }

  return anchor.prefix || anchor.suffix ? anchor : null;
}

function startCopilotJob(document, request) {
  const job = {
    id: randomUUID(),
    documentKey: document.key,
    source: request.source,
    state: "running",
    startedAt: new Date().toISOString(),
    threadId: request.threadId,
    message: "Copilot is reviewing things.",
    cursor: request.cursor ?? null,
  };
  activeCopilotJobs.set(job.id, job);
  document.lastJob = job;
  broadcast(document.key, jobEvent(document, job));

  void runCopilotJob(document, job, request);
  return job;
}

async function runCopilotJob(document, job, request) {
  let workerSession = null;
  let unsubscribeStatus = null;
  try {
    const prompt = buildCopilotPrompt(document, request);
    workerSession = await createWorkerSession(document, job);
    unsubscribeStatus = workerSession.on((event) => {
      try {
        const next = deriveJobStatus(event);
        if (next && next !== job.message) {
          job.message = next;
          broadcast(document.key, jobEvent(document, job));
        }
      } catch {}
    });
    broadcast(document.key, jobEvent(document, job));
    await workerSession.sendAndWait(
      {
        prompt,
        attachments: [{ type: "file", path: document.filePath, displayName: basename(document.filePath) }],
      },
      300000,
    );
    await refreshDocumentFromDisk(document, "copilot");
    job.state = "succeeded";
    job.message = "Copilot finished editing the markdown file.";
  } catch (error) {
    job.state = "failed";
    job.message = error instanceof Error ? error.message : String(error);
    await session.log(`Documint Copilot job failed: ${job.message}`, { level: "error" });
  } finally {
    if (unsubscribeStatus) {
      try {
        unsubscribeStatus();
      } catch {}
    }
    if (workerSession) {
      await workerSession.disconnect().catch(() => {});
    }
    job.finishedAt = new Date().toISOString();
    document.lastJob = job;
    activeCopilotJobs.delete(job.id);
    broadcast(document.key, jobEvent(document, job));
  }
}

// Drives the presence status pill from worker session events. Intent gives
// us model-authored prose; reasoning surfaces the first sentence of the
// model's extended thinking (with a length cap), falling back to a generic
// heartbeat when no content is available.
function deriveJobStatus(event) {
  if (!event || !event.type) {
    return null;
  }
  if (event.type === "assistant.intent") {
    return event.data?.intent?.trim() || null;
  }
  if (event.type === "assistant.reasoning") {
    const content = event.data?.content?.trim();
    if (!content) {
      return "Thinking…";
    }
    const match = content.match(/^[^.!?\n]{1,140}[.!?]/);
    return (match ? match[0] : content.slice(0, 140)).trim();
  }
  return null;
}

async function createWorkerSession(document, job) {
  const client = await getChildClient();
  const revisionGate = createWorkerRevisionGate(document);
  const workerSession = await client.createSession({
    clientName: "Documint worker",
    enableConfigDiscovery: false,
    hooks: {
      onPreToolUse: revisionGate.onPreToolUse,
      onPostToolUse: revisionGate.onPostToolUse,
    },
    infiniteSessions: { enabled: false },
    onPermissionRequest: approveAll,
    workingDirectory: parentWorkingDirectory(),
  });

  job.childSessionId = workerSession.sessionId;
  await workerSession.rpc.mode.set({ mode: "autopilot" }).catch(() => {});
  return workerSession;
}

function createWorkerRevisionGate(document) {
  let readRevision = null;

  return {
    onPreToolUse: async (input) => {
      const access = classifyDocumentToolAccess(input, document.filePath);
      if (!access) {
        return { permissionDecision: "allow" };
      }

      await refreshDocumentFromDisk(document, "disk");
      if (access === "read") {
        readRevision = document.revision;
        return { permissionDecision: "allow" };
      }

      if (readRevision !== document.revision) {
        return {
          permissionDecision: "deny",
          permissionDecisionReason:
            readRevision === null
              ? `Read ${document.filePath} before editing it so Documint can protect the current revision.`
              : `The Documint document advanced from revision ${readRevision} to ${document.revision}. Re-read ${document.filePath} before editing it again.`,
        };
      }

      return { permissionDecision: "allow" };
    },
    onPostToolUse: async (input) => {
      if (classifyDocumentToolAccess(input, document.filePath) !== "write") {
        return;
      }
      if (input.toolResult?.resultType && input.toolResult.resultType !== "success") {
        return;
      }

      await refreshDocumentFromDisk(document, "copilot");
      readRevision = document.revision;
    },
  };
}

function classifyDocumentToolAccess(input, filePath) {
  const toolName = String(input.toolName ?? "").toLowerCase();
  const args = input.toolArgs;

  if (toolName === "bash" || toolName === "shell") {
    const command = readCommandArgument(args);
    if (!command || !commandReferencesFile(command, filePath)) {
      return null;
    }
    return commandWritesFile(command, filePath) || !commandReadsFile(command) ? "write" : "read";
  }

  if (!toolArgsReferenceFile(args, filePath)) {
    return null;
  }

  if (toolName === "str_replace_editor") {
    return String(args?.command ?? "").toLowerCase() === "view" ? "read" : "write";
  }
  if (isWriteToolName(toolName)) {
    return "write";
  }
  if (isReadToolName(toolName)) {
    return "read";
  }
  return null;
}

function isReadToolName(toolName) {
  return /(^|[_-])(cat|grep|head|less|open|read|search|view)([_-]|$)/.test(toolName);
}

function isWriteToolName(toolName) {
  return /(^|[_-])(append|create|edit|patch|replace|write)([_-]|$)/.test(toolName);
}

function toolArgsReferenceFile(value, filePath) {
  return collectToolPaths(value).some((candidate) => pathsEqual(candidate, filePath));
}

function collectToolPaths(value) {
  if (!value || typeof value !== "object") {
    return [];
  }

  const paths = [];
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && /(^|_)(file|filename|path)(_|$)/i.test(key)) {
      paths.push(child);
    } else if (Array.isArray(child)) {
      for (const item of child) {
        paths.push(...collectToolPaths(item));
      }
    } else if (child && typeof child === "object") {
      paths.push(...collectToolPaths(child));
    }
  }
  return paths;
}

function readCommandArgument(args) {
  if (!args || typeof args !== "object") {
    return null;
  }
  return typeof args.command === "string" ? args.command : null;
}

function commandReferencesFile(command, filePath) {
  return command.includes(filePath) || command.includes(shellRelativePath(filePath));
}

function commandWritesFile(command, filePath) {
  const escapedPath = escapeRegExp(filePath);
  const escapedRelativePath = escapeRegExp(shellRelativePath(filePath));
  return new RegExp(`(>|>>|tee\\s+(?:-a\\s+)?|mv\\s+\\S+\\s+|cp\\s+\\S+\\s+)["']?(?:${escapedPath}|${escapedRelativePath})["']?(\\s|$)`).test(
    command,
  );
}

function commandReadsFile(command) {
  return /^\s*(cat|grep|head|less|more|tail|wc|sed\s+-n|awk)\b/.test(command);
}

function pathsEqual(left, right) {
  return resolve(parentWorkingDirectory(), left) === resolve(parentWorkingDirectory(), right);
}

function shellRelativePath(filePath) {
  const relativePath = relative(parentWorkingDirectory(), filePath);
  return relativePath && !relativePath.startsWith("..") && !relativePath.startsWith(`..${sep}`) ? relativePath : filePath;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getChildClient() {
  if (!childClientPromise) {
    childClientPromise = Promise.resolve(
      new CopilotClient({
        connection: RuntimeConnection.forStdio({ path: process.execPath }),
        env: process.env,
        workingDirectory: process.cwd(),
      }),
    );
  }
  return childClientPromise;
}

const COMMENT_TRIAGE_RUBRIC = `First decide how to respond. The latest comment may be:
(a) A request to change the document body — e.g. "fix this typo", "rewrite this paragraph", "add a section about X", "remove the second bullet", "merge these two paragraphs".
(b) A request for information, feedback, or review — e.g. "what does this mean?", "is this section clear?", "explain the tradeoffs", "check whether this matches the implementation", "does this match what we agreed?". This includes off-document work such as inspecting the parent session's files or searching the repository before replying.
(c) An acknowledgement or no-op — e.g. "thanks", "looks good", "approved", "resolved", "never mind".
(d) A mix of (a) and (b).

For (a) — edit the document body to satisfy the request, then reply in the thread with a brief summary of what changed.
For (b) — do not change the document body. Reply in the thread with the answer, feedback, or analysis.
For (c) — do not change the document body. Add a brief acknowledgement reply only if one would help the user; otherwise add nothing.
For (d) — first make the body edit, then reply in the thread with both the answer to the question and a brief summary of the change.

Default to preserving the document body. Only change the body when the latest comment clearly asks Copilot to change it. When in doubt, do not edit; reply with a clarifying question instead.`;

function buildCopilotPrompt(document, request) {
  const filePath = document.filePath;
  const isComment = isCommentRequest(request);
  const isDocumentMention = request.trigger === "document-mention";
  let opener;
  let context;

  if (isComment) {
    const threadJson = request.thread
      ? JSON.stringify(request.thread, null, 2)
      : "(thread payload unavailable)";
    opener =
      request.trigger === "thread-reply"
        ? "A new reply was added to a Documint comment thread that previously mentioned @Copilot. Read the latest reply and decide how to respond."
        : "A Documint comment thread mentioned @Copilot. Read the comment and decide how to respond.";
    context = `Comment source:
${request.source}

Thread ID:
${request.threadId ?? "(none)"}

Latest comment body:
${request.body || "(empty)"}

Thread payload:
${threadJson}`;
  } else {
    const instructionLabel = isDocumentMention
      ? "Mentioned line markdown"
      : "Supplied instructions";
    const lineNumberSection = isDocumentMention
      ? `\n\nMentioned line number:\n${request.lineNumber ?? "(none)"}`
      : "";
    opener = isDocumentMention
      ? "A Documint markdown document line mentioned @Copilot. Edit the backing markdown file directly to satisfy the instruction on that line."
      : "A Documint canvas action asked Copilot to edit the markdown file. Edit the backing markdown file directly to satisfy the supplied instructions.";
    context = `Source:
${request.source}

${instructionLabel}:
${request.body || "(empty)"}${lineNumberSection}`;
  }
  const instructions = [
    isComment
      ? `Always read ${filePath} before any file change, including a comment-thread reply (replies live in the trailing :::documint-comments JSON in this same file).`
      : `Read ${filePath} before editing it, then modify that file directly without creating a copy.`,
    `If a file edit is denied because the Documint document changed, re-read ${filePath} and retry the edit against the latest contents.`,
    `Avoid shell commands for writing ${filePath}; use file editing tools so Documint can protect document revisions.`,
    "Treat the parent Copilot session as the source of intent and working context for this Documint document.",
    `Use the parent session working directory when you need to inspect project files, answer questions, or understand repository state before ${
      isComment ? "replying or editing" : "editing the document"
    }.`,
    "Use the parent session workspace when you need persisted session context such as plan.md, checkpoints, files, or other session artifacts.",
  ];

  if (isComment) {
    const timestamp = new Date().toISOString();
    instructions.push(
      "If you edit the document body, keep the edit scoped to the comment request and the parent session intent.",
      "Preserve unrelated document body content and the trailing :::documint-comments directive.",
      "If you update comment JSON, keep the Documint comment JSON valid.",
      `To add a thread reply, append a new object to the matching thread's "comments" array in the trailing :::documint-comments JSON. Match the thread by the provided payload (quote/anchor/existing comments; the persisted JSON may omit the runtime id). Set "updatedAt" to "${timestamp}" and "body" to the reply text.`,
      "No inline document-level @Copilot mention cleanup is needed for this request.",
      "When finished, briefly summarize what changed; for reply-only responses, note that the response was posted in the thread.",
    );
  } else {
    instructions.push(
      "The instruction may require researching the parent session's files/context before deciding what document edit is appropriate.",
      "Keep the final edit scoped to the instruction and the parent session intent.",
      "Preserve unrelated document body content and the trailing :::documint-comments directive.",
      "If you update comment JSON, keep the Documint comment JSON valid.",
      "No comment thread is associated with this request; do not add a comment-thread reply.",
    );
    if (isDocumentMention) {
      instructions.push(
        "When the requested edit is complete, delete the inline @Copilot mention link from the markdown (for example, remove `@[Copilot](copilot)` from the mentioned line).",
      );
    }
    instructions.push("When finished, briefly summarize what changed.");
  }

  return `${opener}${isComment ? `\n\n${COMMENT_TRIAGE_RUBRIC}` : ""}

Parent Copilot session ID:
${session?.sessionId ?? "(unknown)"}

Parent session working directory:
${parentWorkingDirectory()}

Parent session workspace:
${session?.workspacePath ?? "(not available)"}

Backing file:
${filePath}

${context}

Instructions:
${formatInstructionBullets(instructions)}`;
}

function isCommentRequest(request) {
  return request.trigger === "direct-mention" || request.trigger === "thread-reply";
}

function readCommentTrigger(value) {
  return value === "thread-reply" ? "thread-reply" : "direct-mention";
}

function formatInstructionBullets(instructions) {
  return instructions.map((instruction) => `- ${instruction}`).join("\n");
}

function parentWorkingDirectory() {
  return process.cwd();
}

function subscribe(document, response, clientId) {
  response.statusCode = 200;
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("Content-Type", "text/event-stream");

  let set = subscribers.get(document.key);
  if (!set) {
    set = new Set();
    subscribers.set(document.key, set);
  }
  const subscriber = {
    clientId: typeof clientId === "string" && clientId ? clientId : null,
    response,
  };
  set.add(subscriber);

  const dropSubscriber = () => {
    if (!set.delete(subscriber)) {
      return;
    }
    if (set.size === 0) {
      subscribers.delete(document.key);
    }
  };

  // Listen for both terminal signals: without an "error" listener Node
  // surfaces stream errors as uncaughtException, and a half-open response
  // that errors without firing "close" would otherwise linger in the set.
  response.on("close", dropSubscriber);
  response.on("error", (error) => {
    void session
      .log(
        `Documint SSE subscriber errored for ${document.key}; dropping: ${error instanceof Error ? error.message : String(error)}`,
        { level: "error" },
      )
      .catch(() => {});
    dropSubscriber();
  });

  response.write(`data: ${JSON.stringify({ type: "state", state: toClientState(document) })}\n\n`);
}

function broadcast(key, payload, options = {}) {
  const set = subscribers.get(key);
  if (!set) {
    return;
  }
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const subscriber of set) {
    if (options.skipClientId && subscriber.clientId === options.skipClientId) {
      continue;
    }
    subscriber.response.write(data);
  }
}

function toClientState(document) {
  const activeJobs = activeJobsForDocument(document.key).map(jobSummary);
  return {
    content: document.content,
    copilotUser: {
      id: copilotUserId,
      username: "copilot",
      fullName: "Copilot",
    },
    job: activeJobs.at(-1) ?? jobSummary(document.lastJob),
    jobs: activeJobs,
    path: document.filePath,
    revision: document.revision,
    shortPath: shortPath(document.filePath),
    title: document.title,
    updatedAt: document.updatedAt,
  };
}

function jobEvent(document, job) {
  return {
    type: "job",
    job: jobSummary(job),
    jobs: activeJobsForDocument(document.key).map(jobSummary),
  };
}

function activeJobsForDocument(documentKey) {
  return Array.from(activeCopilotJobs.values()).filter((job) => job.documentKey === documentKey);
}

function contentEvent(document, source, metadata = {}) {
  return {
    type: "content",
    content: document.content,
    path: document.filePath,
    revision: document.revision,
    source,
    updatedAt: document.updatedAt,
    ...metadata,
  };
}

async function sendStorageFile(response, document, storagePath) {
  let filePath;
  try {
    filePath = resolveStoragePath(document, storagePath);
  } catch (error) {
    if (error instanceof CanvasError) {
      sendJson(response, 400, { error: error.message });
      return;
    }
    throw error;
  }

  let body;
  try {
    body = await readFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      sendJson(response, 404, { error: "Storage file not found." });
      return;
    }
    throw error;
  }

  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Length": body.length,
    "Content-Type": inferMimeType(filePath),
  });
  response.end(body);
}

async function writeStorageFile(document, request) {
  const bytes = await readBody(request, requestBodyLimitBytes);
  const directory = join(dirname(document.filePath), "assets");
  const fileName = uniqueStorageFileName(readFileNameHeader(request), readContentTypeHeader(request));
  const filePath = join(directory, fileName);

  await mkdir(directory, { recursive: true });
  await writeFile(filePath, bytes);

  return {
    path: toPosixPath(relative(dirname(document.filePath), filePath)),
  };
}

function readFileNameHeader(request) {
  const value = readHeader(request, "x-file-name");
  if (!value) {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readContentTypeHeader(request) {
  return readHeader(request, "content-type").split(";")[0].trim().toLowerCase() || "application/octet-stream";
}

function readHeader(request, name) {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function resolveStoragePath(document, storagePath) {
  if (/^(https?:|data:|blob:)/i.test(storagePath)) {
    throw new CanvasError("unsupported_storage_path", "Remote URLs are handled by the browser.");
  }

  const documentDirectory = dirname(document.filePath);
  const filePath = storagePath.startsWith("file:")
    ? fileURLToPath(new URL(storagePath))
    : isAbsolute(storagePath)
    ? resolve(storagePath)
    : resolve(documentDirectory, storagePath);
  const relativePath = relative(documentDirectory, filePath);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new CanvasError("storage_path_outside_document", "Storage files must live beside the markdown document.");
  }

  return filePath;
}

function uniqueStorageFileName(name, mimeType) {
  const fallbackName = `pasted${extensionForMimeType(mimeType)}`;
  const safeName = basename(typeof name === "string" && name.trim() ? name : fallbackName)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const normalizedName = safeName || fallbackName;
  return `${Date.now()}-${randomUUID().slice(0, 8)}-${normalizedName}`;
}

function inferMimeType(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function extensionForMimeType(mimeType) {
  switch (mimeType) {
    case "image/gif":
      return ".gif";
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/svg+xml":
      return ".svg";
    case "image/webp":
      return ".webp";
    default:
      return ".bin";
  }
}

function toPosixPath(path) {
  return path.split("\\").join("/");
}

function jobSummary(job) {
  if (!job) {
    return null;
  }
  return {
    finishedAt: job.finishedAt,
    id: job.id,
    message: job.message,
    cursor: job.cursor,
    childSessionId: job.childSessionId,
    source: job.source,
    startedAt: job.startedAt,
    state: job.state,
    threadId: job.threadId,
  };
}

async function readJson(request) {
  const body = await readBody(request, requestBodyLimitBytes);
  if (body.length === 0) {
    return {};
  }
  return JSON.parse(body.toString("utf8"));
}

async function readBody(request, limitBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limitBytes) {
      throw new CanvasError("payload_too_large", "Request body is too large.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendHtml(response) {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Documint Markdown Agent</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/app.js"></script>
  </body>
</html>`;
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

async function sendFile(response, filePath, contentType) {
  const body = await readFile(filePath);
  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Length": body.length,
    "Content-Type": contentType,
  });
  response.end(body);
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(body);
}

function shortPath(filePath) {
  const cwdRelative = relative(process.cwd(), filePath);
  if (!cwdRelative.startsWith("..") && !isAbsolute(cwdRelative)) {
    return cwdRelative || basename(filePath);
  }
  return filePath;
}
