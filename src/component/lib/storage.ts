import type { DocumintStorage } from "@/types";

// Matches URLs the component handles directly without routing through host
// storage: http(s):, data:, and blob: are all "remote" in the sense that the
// browser can resolve them natively.
const REMOTE_URL = /^(https?:|data:|blob:)/i;

// Wraps the host-provided DocumintStorage and a window reference into a
// single object that routes readFile and openFile calls based on whether the
// URL is remote or local. Hooks receive this instance and call methods
// directly without needing to know about the remote/local distinction.
export class DocumentStorage implements DocumintStorage {
  constructor(
    private readonly storage: DocumintStorage | undefined,
    private readonly view: Window | null,
  ) {}

  // Remote URLs are fetched directly; local paths route through host storage.
  async readFile(url: string): Promise<Blob | null> {
    if (REMOTE_URL.test(url)) {
      try {
        const res = await fetch(url);
        return res.ok ? res.blob() : null;
      } catch {
        return null;
      }
    }
    return this.storage?.readFile(url) ?? null;
  }

  writeFile(file: File): Promise<string> {
    if (!this.storage?.writeFile) throw new Error("No storage configured");
    return this.storage.writeFile(file);
  }

  // Remote URLs open in a new tab; local paths route through host storage.
  openFile(url: string): void {
    if (REMOTE_URL.test(url)) {
      this.view?.open(url, "_blank", "noopener,noreferrer");
    } else {
      this.storage?.openFile?.(url);
    }
  }
}
