import { randomUUID } from "crypto";
import * as path from "path";
import * as vscode from "vscode";

const MEDIA_MIME_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export function resolveResourceUri(documentUri: vscode.Uri, requestedPath: string): vscode.Uri {
  if (documentUri.scheme !== "file") {
    throw new Error("Local resource access requires a file-backed Markdown document.");
  }

  const resourcePath = requestedPath.trim();
  if (!resourcePath) {
    throw new Error("Resource path cannot be empty.");
  }

  const documentDirectory = path.dirname(documentUri.fsPath);
  if (
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(resourcePath) &&
    !resourcePath.startsWith("file://") &&
    !path.isAbsolute(resourcePath)
  ) {
    throw new Error(`Unsupported resource URI scheme in ${resourcePath}`);
  }

  const candidatePath = resourcePath.startsWith("file://")
    ? vscode.Uri.parse(resourcePath).fsPath
    : path.resolve(documentDirectory, resourcePath);
  const allowedRoot =
    vscode.workspace.getWorkspaceFolder(documentUri)?.uri.fsPath ?? documentDirectory;

  if (!isPathInside(candidatePath, allowedRoot)) {
    throw new Error(`Refusing to access a resource outside ${allowedRoot}`);
  }

  return vscode.Uri.file(candidatePath);
}

export async function writeDocumentAsset(
  documentUri: vscode.Uri,
  fileName: string,
  data: ArrayBuffer,
): Promise<string> {
  if (documentUri.scheme !== "file") {
    throw new Error("Asset uploads require a file-backed Markdown document.");
  }

  const documentDirectory = path.dirname(documentUri.fsPath);
  const documentBaseName = path.parse(documentUri.fsPath).name;
  const assetDirectory = vscode.Uri.file(
    path.join(documentDirectory, `${documentBaseName}.assets`),
  );
  const targetUri = vscode.Uri.joinPath(
    assetDirectory,
    `${randomUUID()}-${sanitizeFileName(fileName)}`,
  );

  await vscode.workspace.fs.createDirectory(assetDirectory);
  await vscode.workspace.fs.writeFile(targetUri, new Uint8Array(data));

  return path.relative(documentDirectory, targetUri.fsPath).replaceAll(path.sep, "/");
}

export function getMediaMimeType(uri: vscode.Uri): string {
  return MEDIA_MIME_TYPES[path.extname(uri.path).toLowerCase()] ?? "application/octet-stream";
}

function sanitizeFileName(fileName: string): string {
  return (
    path.posix
      .basename(fileName.replaceAll("\\", "/"))
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/^[.-]+/, "")
      .replace(/[.-]+$/, "")
      .replace(/-+/g, "-") || "asset"
  );
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
