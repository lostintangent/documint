import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { EditorState } from "@/editor";
import type { DocumintStore } from ".";
import type { DocumintStoreValue } from "./core/values";

const DocumintStoreContext = createContext<DocumintStore | null>(null);

export function DocumintStoreProvider({
  children,
  store,
}: {
  children: ReactNode;
  store: DocumintStore;
}) {
  return <DocumintStoreContext.Provider value={store}>{children}</DocumintStoreContext.Provider>;
}

export function useDocumintStore() {
  const store = useContext(DocumintStoreContext);

  if (!store) {
    throw new Error("Documint store is unavailable outside DocumintStoreProvider.");
  }

  return store;
}

export function useEditorCommand<A extends unknown[]>(
  command: (state: EditorState, ...args: A) => EditorState | null,
) {
  const editor = useDocumintStore().editor;

  return useCallback((...args: A) => editor.command(command, ...args), [editor, command]);
}

export function useStoreValue<T, Params extends readonly unknown[]>(
  value: DocumintStoreValue<T, Params>,
  ...params: Params
) {
  const store = useDocumintStore();
  const subscribe = useCallback(
    (listener: () => void) => value.subscribe(store, listener, ...params),
    [store, value, ...params],
  );
  const getSnapshot = useCallback(() => value.read(store, ...params), [store, value, ...params]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
