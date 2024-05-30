import { Effect, pipe, Ref } from 'effect'

export type DbFx<Db> = {
  reset: (v: Db) => Effect.Effect<void, any, any>
  swap: (f: (a: Db) => Db) => Effect.Effect<void>
  assoc: <K extends keyof Db>(k: K, v: Db[K]) => Effect.Effect<void, never, any>
  dissoc: <K extends keyof Db>(k: K) => Effect.Effect<void, never, any>
  updateIn: <K extends keyof Db>(
    k: K,
    f: (x: Db[K]) => Db[K]
  ) => Effect.Effect<void, any, any>
  get: <K extends keyof Db>(k: K) => Effect.Effect<Db[K], any, any>
  deref: () => Effect.Effect<Db>
}

export const DbFx = <Db extends Record<string, any>>(a: Ref.Ref<Db>) => ({
  reset: (v: Db) => Ref.set(a, v),
  swap: (f: (a: Db) => Db) => Ref.update(a, f),
  assoc: <K extends keyof Db>(k: K, v: Db[K]) =>
    Ref.update(a, (a) => ({ ...a, [k]: v })),
  dissoc: <K extends keyof Db>(k: K) =>
    Ref.update(a, (a) => {
      const { [k]: _, ...rest } = a
      return rest as Db
    }),
  updateIn: <K extends keyof Db>(k: K, f: (x: Db[K]) => Db[K]) =>
    Ref.update(a, (a) => ({ ...a, [k]: f(a[k]) })),
  get: <K extends keyof Db>(k: K) =>
    pipe(
      Ref.get(a),
      Effect.map((x) => x[k])
    ),
  deref: () => Ref.get(a),
})

/**
 * Provides functions that update the value in ref, persisting with the provided `persist` function.
 * @param a
 * @param persist
 * @param config
 */
const withExternalPersistence = <T extends Record<string, any>>(
  a: Ref.Ref<T>,
  persist: (a: T) => Effect.Effect<void, any, any>,
  config?: { debounceTimeout?: number }
) => ({
  swap: (f: (a: T) => T) =>
    pipe(Ref.updateAndGet(a, f), Effect.flatMap(persist)),
  assoc: <K extends keyof T>(k: K, v: T[K]) =>
    pipe(
      Ref.updateAndGet(a, (a) => ({ ...a, [k]: v })),
      Effect.flatMap(persist)
    ),
  get: () => Ref.get(a),
})

/**
 * Returns an Effect from a predicate function
 * @param f
 */
const fromPredicate =
  <T>(f: (x: T) => boolean | [boolean, string]) =>
  (x: any): Effect.Effect<boolean, string | undefined> => {
    const ret = f(x)
    if (Array.isArray(ret)) {
      const [b, reason] = ret
      return b ? Effect.succeed(x) : Effect.fail(reason)
    }
    return ret ? Effect.succeed(x) : Effect.fail(void 0)
  }
