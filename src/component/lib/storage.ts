// Host-provided storage for reading/writing resources needed by the document.
//
// `readFile` is invoked when the document references a non-remote URL (i.e.
// anything that isn't `http(s):`, `data:`, or `blob:`); the host returns the
// bytes as a Blob, or `null` to signal "not found" (rendered as an error
// placeholder). The path is whatever string appears in the markdown — relative
// (`./food.png`), absolute (`file:///…`), or a custom scheme — and is opaque
// to the component.
//
// `writeFile` is invoked when content is pasted into the document (currently
// images): the component hands over the pasted file and the host persists it,
// returning a path string that will round-trip back through `readFile` on the
// next render. The host can derive a name, MIME type, and extension from the
// `File` directly.
//
// `openFile` is invoked when the user cmd+clicks a non-remote link. The host
// is responsible for opening the path in the appropriate way (e.g. opening a
// file in the OS, navigating within the app, etc.).
export type DocumintStorage = {
  readFile(path: string): Promise<Blob | null>;
  writeFile(file: File): Promise<string>;
  openFile?(path: string): void;
};

// Matches URLs the component handles directly without routing through host
// storage: http(s):, data:, and blob: are all "remote" in the sense that the
// browser can resolve them natively.
export const REMOTE_URL = /^(https?:|data:|blob:)/i;

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
