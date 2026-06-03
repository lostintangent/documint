import { useMemo } from "react";
import type { DocumintStorage } from "documint";

export function useStorage(instanceId: string | null): DocumintStorage {
  return useMemo(() => createWorkspaceStorage(instanceId), [instanceId]);
}

function createWorkspaceStorage(instanceId: string | null): DocumintStorage {
  return {
    async readFile(path) {
      const response = await fetch(
        `/api/storage?instanceId=${encodeInstanceId(instanceId)}&path=${encodeURIComponent(path)}`,
      );
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? `Unable to read ${path}`);
      }
      return response.blob();
    },
    async writeFile(file) {
      const response = await fetch(`/api/storage?instanceId=${encodeInstanceId(instanceId)}`, {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
        },
        body: file,
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? `Unable to write ${file.name}`);
      }
      return result.path;
    },
    openFile(path) {
      window.open(
        `/api/storage?instanceId=${encodeInstanceId(instanceId)}&path=${encodeURIComponent(path)}`,
        "_blank",
        "noopener,noreferrer",
      );
    },
  };
}

function encodeInstanceId(instanceId: string | null): string {
  return encodeURIComponent(instanceId ?? "");
}
