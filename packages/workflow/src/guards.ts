import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import { pipe } from 'effect/Function'
import { Guard, GuardArgs } from 'xstate/guards'

export type AnyXStateGuard = Guard<any, any, any, any>

export type EffectGuard = (
  args: AnyXStateGuard
) => Effect.Effect<any, never, boolean>

export type CreateEffectGuards = <API extends { [k: string]: EffectGuard }>(
  api: API,
  runtime: Runtime.Runtime<
    {
      [K in keyof API]: ReturnType<API[K]> extends Effect.Effect<
        infer R,
        any,
        any
      >
        ? R
        : never
    }[keyof API]
  >
) => {
  [K in keyof API]: (args: AnyXStateGuard) => ReturnType<AnyXStateGuard>
}
export type EffectGuards = Record<string, EffectGuard>

export const createEffectGuards: CreateEffectGuards = (api, runtime) => {
  const result = {} as {
    [k in keyof typeof api]: AnyXStateGuard
  }

  const run = Runtime.runSync(runtime)

  for (const key in api) {
    const fn = api[key] as (
      ...args: any[]
    ) => Effect.Effect<any, never, boolean>

    const guard: AnyXStateGuard = (args: GuardArgs<any, any, any>) => {
      // TODO. see if we can access the full state
      //  https://github.com/statelyai/xstate/discussions/4347
      try {
        const stateId: string = key
        return run(
          pipe(
            fn(args),
            Effect.withLogSpan(stateId),
            Effect.tapErrorCause((cause) =>
              Effect.logError('Guard error', cause)
            )
          )
        )
      } catch (e) {
        console.error('[effect-guards] unhandled exception!', e)
        return false
      }
    }

    result[key] = guard
  }
  return result
}
