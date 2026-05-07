import type { EditorState } from "@/editor";
import type { DocumintStore } from "..";
import { defaultEquality, type Equality } from "./equality";

type EditorValueReader<T> = (state: EditorState) => T;

export type DocumintStoreValue<T, Params extends readonly unknown[] = readonly []> = {
  read: (store: DocumintStore, ...params: Params) => T;
  subscribe: (store: DocumintStore, listener: () => void, ...params: Params) => () => void;
};

export function createStoreValue<T, Params extends readonly unknown[] = readonly []>({
  read,
  subscribe,
}: {
  read: (store: DocumintStore, ...params: Params) => T;
  subscribe: (store: DocumintStore, listener: () => void, ...params: Params) => () => void;
}): DocumintStoreValue<T, Params> {
  return { read, subscribe };
}

export function createEditorValue<T>(
  read: EditorValueReader<T>,
  equal: Equality<T> = defaultEquality,
): DocumintStoreValue<T> {
  return createStoreValue({
    read: (store) => read(store.editor.getState()),
    subscribe: (store, listener) => store.editor.subscribeValue(read, listener, equal),
  });
}
