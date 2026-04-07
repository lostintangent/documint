// Owns React lifetime for one editor instance while keeping editor construction
// in the editor subsystem.
import { useRef } from "react";
import { createEditor, type Editor } from "@/editor";

export function useEditor(): Editor {
  const editorRef = useRef<Editor | null>(null);

  if (!editorRef.current) {
    editorRef.current = createEditor();
  }

  return editorRef.current;
}
