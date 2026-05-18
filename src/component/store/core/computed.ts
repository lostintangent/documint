import type { DocumintStore } from "..";
import { defaultEquality, equalRecordByKeys, type Equality } from "./equality";
import type { DocumintSprig } from "./sprigs";

type SprigResults<Deps extends readonly DocumintSprig<unknown>[]> = {
  [Index in keyof Deps]: Deps[Index] extends DocumintSprig<infer Value> ? Value : never;
};

type SprigRecordResults<Values extends Record<string, DocumintSprig<unknown>>> = {
  [Key in keyof Values]: Values[Key] extends DocumintSprig<infer Value> ? Value : never;
};

/**
 * Build a sprig that derives its value from one or more upstream sprigs.
 *
 * The result is cached per `DocumintStore`: re-reads with unchanged dep
 * identities return the cached value without recomputing. `equal` decides
 * whether a freshly-computed value should preserve the prior reference;
 * defaults to `Object.is`.
 *
 * Reach for this when a value derives from store state and nothing else.
 * If it also depends on host props, use `createParameterizedSprig`.
 */
export function createComputedSprig<const Deps extends readonly DocumintSprig<unknown>[], Value>(
  deps: Deps,
  read: (store: DocumintStore, ...values: SprigResults<Deps>) => Value,
  equal: Equality<Value> = defaultEquality,
): DocumintSprig<Value> {
  return createParameterizedSprig<Deps, readonly [], Value>(
    deps,
    (store, _params, ...values) => read(store, ...values),
    equal,
  );
}

/**
 * Build a sprig that bundles several upstream sprigs into a single record,
 * keyed by the same names. The bundled value re-emits only when one of the
 * inner sprigs emits — the record's key-by-key equality (`Object.is` on
 * each field) preserves identity in the steady state.
 *
 * Reach for this when a consumer wants several derived values together as
 * one snapshot (e.g. `selectionViewSprig` packages formatting + handles +
 * normalized selection + viewport).
 */
export function createRecordSprig<Values extends Record<string, DocumintSprig<unknown>>>(
  values: Values,
): DocumintSprig<SprigRecordResults<Values>> {
  const entries = Object.entries(values) as Array<[string, Values[keyof Values]]>;
  const deps = entries.map(([, value]) => value) as DocumintSprig<unknown>[];
  const keys = entries.map(([key]) => key);

  return createComputedSprig(
    deps,
    (_store, ...resolvedValues) => {
      const record = {} as SprigRecordResults<Values>;

      for (let index = 0; index < keys.length; index++) {
        record[keys[index]! as keyof Values] = resolvedValues[
          index
        ] as SprigRecordResults<Values>[keyof Values];
      }

      return record;
    },
    equalRecordByKeys(keys) as Equality<SprigRecordResults<Values>>,
  );
}

/**
 * Build a sprig whose value also depends on host-provided parameters
 * (e.g. host props, hook-local state). Params become part of the cache
 * key alongside dep values.
 *
 * The cache is single-entry per `DocumintStore`, so callers must pass
 * reference-stable params — typically memoize them with `useMemo` or
 * derive them from already-stable values. If two consumers read with
 * different params in the same tick, each read will recompute.
 */
export function createParameterizedSprig<
  const Deps extends readonly DocumintSprig<unknown>[],
  Params extends readonly unknown[],
  Value,
>(
  deps: Deps,
  read: (store: DocumintStore, params: Params, ...values: SprigResults<Deps>) => Value,
  equal: Equality<Value> = defaultEquality,
): DocumintSprig<Value, Params> {
  const cache = new WeakMap<
    DocumintStore,
    {
      depValues: SprigResults<Deps>;
      params: Params;
      value: Value;
    }
  >();

  const readComputed = (store: DocumintStore, ...params: Params) => {
    const depValues = deps.map((dep) => dep.read(store)) as SprigResults<Deps>;
    const cached = cache.get(store);

    if (
      cached &&
      areSprigResultsIdentical(cached.depValues, depValues) &&
      areSprigResultsIdentical(cached.params, params)
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

function areSprigResultsIdentical(previous: readonly unknown[], next: readonly unknown[]) {
  return (
    previous.length === next.length &&
    previous.every((previousValue, index) => Object.is(previousValue, next[index]))
  );
}
