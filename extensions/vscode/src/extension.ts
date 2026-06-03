import * as vscode from "vscode";

import { DocumintEditorProvider } from "./host/textEditorProvider";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(DocumintEditorProvider.register(context));
}
