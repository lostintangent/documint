import type { EditorState } from "@/editor";
import { createEditorValue } from "../core/values";

type EditorValueReader<T> = (state: EditorState) => T;

const editorState: EditorValueReader<EditorState> = (state) => state;

export const editorStateValue = createEditorValue(editorState);

export const documentIndexValue = createEditorValue((state) => state.documentIndex);

export const imageUrlsValue = createEditorValue((state) => state.documentIndex.imageUrls);
