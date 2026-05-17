import { createEditorStateSprig } from "../core/sprigs";

export const editorStateSprig = createEditorStateSprig((state) => state);

export const documentIndexSprig = createEditorStateSprig((state) => state.documentIndex);

export const selectionSprig = createEditorStateSprig((state) => state.selection);

export const imageUrlsSprig = createEditorStateSprig((state) => state.documentIndex.imageUrls);
