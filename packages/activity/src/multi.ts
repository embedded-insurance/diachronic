import { EffectDef, EffectImpl } from './single'
import { Effect, Runtime } from 'effect'
import { Either } from 'effect/Either'

/**
 * Support for assembling defs into a group, addressing them as a group
 */

/**
 * Defines a group
 */
export const defSchema =
  <A extends EffectDef>() =>
  <const B extends Record<string, A>>(a: B) =>
    a
/**
 * Converts a group of effect implementations to a map of promises
 * @param m
 * @param runtime
 */
export const toMapOfPromises = <
  A extends EffectDef,
  Impl extends Record<string, EffectImpl<A, any>>,
  RT extends Runtime.Runtime<
    Effect.Effect.Context<ReturnType<Impl[keyof Impl]>>
  >
>(
  m: Impl,
  runtime: RT
) => {
  const runPromise = Runtime.runPromise(runtime)
  return Object.entries(m).reduce((acc, [k, f]) => {
    // @ts-expect-error
    acc[k] = (a: Parameters<Impl>[0]) => runPromise(f(a))
    return acc
  }, {} as { [K in keyof Impl]: (a: Parameters<Impl[K]>[0]) => Promise<Effect.Effect.Success<ReturnType<Impl[K]>>> })
}

/**
 * Converts a group of effect implementations to a map of promises
 * @param m
 * @param runtime
 */
export const toMapOfPromiseEither = <
  A extends EffectDef,
  Impl extends Record<string, EffectImpl<A, any>>,
  RT extends Runtime.Runtime<
    Effect.Effect.Context<ReturnType<Impl[keyof Impl]>>
  >
>(
  m: Impl,
  runtime: RT
) => {
  const runPromise = Runtime.runPromise(runtime)
  return Object.entries(m).reduce(
    (acc, [k, f]) => {
      // @ts-expect-error
      acc[k] = (a: Parameters<Impl>[0]) => runPromise(f(a), Effect.either)
      return acc
    },
    {} as {
      [K in keyof Impl]: (
        a: Parameters<Impl[K]>[0]
      ) => Promise<
        Either<
          Effect.Effect.Success<ReturnType<Impl[K]>>,
          Effect.Effect.Error<ReturnType<Impl[K]>>
        >
      >
    }
  );
}
