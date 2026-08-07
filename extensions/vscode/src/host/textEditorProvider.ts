import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { getMediaMimeType, resolveResourceUri, writeDocumentAsset } from "./storage";
import type { HostMessage, WebviewMessage } from "../types";

export class DocumintEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "documint.markdownEditor";

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      DocumintEditorProvider.viewType,
      new DocumintEditorProvider(context),
      {
        supportsMultipleEditorsPerDocument: false,
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      },
    );
  }

  private constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _: vscode.CancellationToken,
  ): Promise<void> {
    const webview = webviewPanel.webview;
    const postMessage = (message: HostMessage) => webview.postMessage(message);

    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview")],
    };

    let editQueue = Promise.resolve();

    let syncedContent = document.getText();
    const syncContent = (content = document.getText()) => {
      syncedContent = content;
      void postMessage({
        type: "set-content",
        content,
      });
    };

    const disposables: vscode.Disposable[] = [];
    disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === document.uri.toString()) {
          const content = event.document.getText();
          if (content !== syncedContent) {
            syncContent(content);
          }
        }
      }),
    );

    webviewPanel.onDidDispose(() => {
      for (const disposable of disposables.splice(0)) {
        disposable.dispose();
      }
    });

    disposables.push(
      webview.onDidReceiveMessage(async (message: WebviewMessage) => {
        switch (message.type) {
          case "ready":
            syncContent();
            break;

          case "edit-content":
            editQueue = editQueue.then(async () => {
              const edit = this.createWorkspaceEdit(document, message.content);

              // The workspace is already set to the
              // sent edit, so there's nothing to do.
              if (!edit) return;

              syncedContent = message.content;

              const applied = await vscode.workspace.applyEdit(edit);

              // Something prevent the edit from being applied so
              // reject the edit by resyncing the last seen content.
              if (!applied) {
                syncContent();

                vscode.window.showErrorMessage(`Unable to update ${document.uri.toString()}.`);
                return;
              }
            });

            await editQueue;
            break;

          case "read-path":
            try {
              const uri = resolveResourceUri(document.uri, message.path);
              const data = await vscode.workspace.fs.readFile(uri);

              await postMessage({
                type: "read-result",
                id: message.id,
                data: new Uint8Array(data).buffer,
                mimeType: getMediaMimeType(uri),
              });
            } catch {
              void vscode.window.showErrorMessage(
                `The requested file doesn't appear to exist: ${message.path}.`,
              );

              await postMessage({
                type: "read-result",
                id: message.id,
                data: null,
              });
            }
            break;

          case "write-path":
            await postMessage({
              type: "write-result",
              id: message.id,
              path: await writeDocumentAsset(document.uri, message.name, message.data),
            });
            break;

          case "open-path":
            await vscode.commands.executeCommand(
              "vscode.open",
              resolveResourceUri(document.uri, message.path),
            );
            break;
        }
      }),
    );

    webview.html = this.getWebviewHtml(webview);
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString("base64");
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "main.js"),
    );
    const contentSecurityPolicy = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: http: data: blob:`,
      `font-src ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `worker-src ${webview.cspSource} blob:`,
      `connect-src ${webview.cspSource} https: http:`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta
		http-equiv="Content-Security-Policy"
		content="${contentSecurityPolicy}"
	>
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Documint</title>
	<style nonce="${nonce}">
		html, body, #root { height: 100%; }
		body { margin: 0; padding: 0; background: var(--vscode-editor-background); }
	</style>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" type="module" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }

  private createWorkspaceEdit(
    document: vscode.TextDocument,
    content: string,
  ): vscode.WorkspaceEdit | null {
    const currentContent = document.getText();
    if (currentContent === content) return null;

    let startOffset = 0;
    while (
      startOffset < currentContent.length &&
      startOffset < content.length &&
      currentContent[startOffset] === content[startOffset]
    ) {
      startOffset += 1;
    }

    let currentEndOffset = currentContent.length;
    let nextEndOffset = content.length;
    while (
      currentEndOffset > startOffset &&
      nextEndOffset > startOffset &&
      currentContent[currentEndOffset - 1] === content[nextEndOffset - 1]
    ) {
      currentEndOffset -= 1;
      nextEndOffset -= 1;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(startOffset), document.positionAt(currentEndOffset)),
      content.slice(startOffset, nextEndOffset),
    );

    return edit;
  }
}
