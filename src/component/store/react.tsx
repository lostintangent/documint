import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { EditorState } from "@/editor";
import type { DocumintStore } from ".";
import type { DocumintSprig } from "./core/sprigs";

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

export function useSprig<T, Params extends readonly unknown[]>(
  sprig: DocumintSprig<T, Params>,
  ...params: Params
) {
  const store = useDocumintStore();
  const subscribe = useCallback(
    (listener: () => void) => sprig.subscribe(store, listener, ...params),
    // Track parameter identities individually; the rest tuple itself is new
    // on every render and would force needless external-store resubscriptions.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [store, sprig, ...params],
  );
  const getSnapshot = useCallback(
    () => sprig.read(store, ...params),
    // Keep snapshot identity aligned with the subscription's parameter tuple.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [store, sprig, ...params],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
