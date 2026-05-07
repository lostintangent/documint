import type { DocumintStore } from "..";
import { defaultEquality, type Equality } from "./equality";
import type { DocumintStoreValue } from "./values";

type StoreValueResults<Deps extends readonly DocumintStoreValue<unknown>[]> = {
  [Index in keyof Deps]: Deps[Index] extends DocumintStoreValue<infer Value> ? Value : never;
};

type StoreValueRecordResults<Values extends Record<string, DocumintStoreValue<unknown>>> = {
  [Key in keyof Values]: Values[Key] extends DocumintStoreValue<infer Value> ? Value : never;
};

export function createStoreComputedValue<
  Deps extends readonly DocumintStoreValue<unknown>[],
  Value,
>(
  deps: Deps,
  read: (store: DocumintStore, ...values: StoreValueResults<Deps>) => Value,
  equal: Equality<Value> = defaultEquality,
): DocumintStoreValue<Value> {
  return createParameterizedStoreComputedValue<Deps, readonly [], Value>(
    deps,
    (store, _params, ...values) => read(store, ...values),
    equal,
  );
}

export function createStoreRecordValue<Values extends Record<string, DocumintStoreValue<unknown>>>(
  values: Values,
): DocumintStoreValue<StoreValueRecordResults<Values>> {
  const entries = Object.entries(values) as Array<[keyof Values, Values[keyof Values]]>;
  const deps = entries.map(([, value]) => value) as DocumintStoreValue<unknown>[];

  return createStoreComputedValue(
    deps,
    (_store, ...resolvedValues) => {
      const record = {} as StoreValueRecordResults<Values>;

      for (let index = 0; index < entries.length; index++) {
        const [key] = entries[index]!;
        record[key] = resolvedValues[index] as StoreValueRecordResults<Values>[keyof Values];
      }

      return record;
    },
    equalStoreRecords,
  );
}

export function createParameterizedStoreComputedValue<
  Deps extends readonly DocumintStoreValue<unknown>[],
  Params extends readonly unknown[],
  Value,
>(
  deps: Deps,
  read: (store: DocumintStore, params: Params, ...values: StoreValueResults<Deps>) => Value,
  equal: Equality<Value> = defaultEquality,
): DocumintStoreValue<Value, Params> {
  const cache = new WeakMap<
    DocumintStore,
    {
      depValues: StoreValueResults<Deps>;
      params: Params;
      value: Value;
    }
  >();

  const readComputed = (store: DocumintStore, ...params: Params) => {
    const depValues = deps.map((dep) => dep.read(store)) as StoreValueResults<Deps>;
    const cached = cache.get(store);

    if (
      cached &&
      areStoreValueResultsIdentical(cached.depValues, depValues) &&
      areStoreValueResultsIdentical(cached.params, params)
    ) {
      return cached.value;
    }

    const nextValue = read(store, params, ...depValues);
    const value = cached && equal(cached.value, nextValue) ? cached.value : nextValue;
    cache.set(store, { depValues, params, value });
    return value;
  };

  return {
    read: readComputed,
    subscribe(store, listener, ...params) {
      let selected = readComputed(store, ...params);

      const notifyIfChanged = () => {
        const nextSelected = readComputed(store, ...params);
        if (equal(selected, nextSelected)) {
          return;
        }

        selected = nextSelected;
        listener();
      };

      const unsubscribers = deps.map((dep) => dep.subscribe(store, notifyIfChanged));

      return () => {
        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }
      };
    },
  };
}

function equalStoreRecords(previous: Record<string, unknown>, next: Record<string, unknown>) {
  if (previous === next) return true;

  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length !== nextKeys.length) return false;

  return previousKeys.every((key) => Object.is(previous[key], next[key]));
}

function areStoreValueResultsIdentical(previous: readonly unknown[], next: readonly unknown[]) {
  return (
    previous.length === next.length &&
    previous.every((previousValue, index) => Object.is(previousValue, next[index]))
  );
}
