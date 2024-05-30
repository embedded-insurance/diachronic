import { Action, ActionArgs, assign, EventObject, MachineContext } from 'xstate'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import { pipe } from 'effect/Function'

export type AnyXStateAction = Action<any, any, any, any, any, any, any>

const AssignEffectSymbol: unique symbol = Symbol.for('diachronic.assign-effect')
type AssignEffectSymbol = typeof AssignEffectSymbol

type EffectAction = (args: ActionArgs<any, any, any>) => Effect.Effect<
  any,
  never,
  any
> & {
  [AssignEffectSymbol]?: AssignEffectSymbol
}

export type AssignEffect = (args: ActionArgs<any, any, any>) => Effect.Effect<
  any,
  never,
  any
> & {
  [AssignEffectSymbol]: AssignEffectSymbol
}

export const assignEffect = <
  Context extends MachineContext,
  Event extends EventObject
>(
  fn: (
    args: ActionArgs<Context, Event, any>
  ) => Effect.Effect<Context, never, any>
): EffectAction => {
  // @ts-expect-error
  fn[AssignEffectSymbol] = AssignEffectSymbol
  return fn
}

export type CreateEffectActions = <API extends { [k: string]: EffectAction }>(
  api: API,
  runtime: Runtime.Runtime<
    {
      [K in keyof API]: ReturnType<API[K]> extends Effect.Effect<any, any, infer R>
        ? R
        : never
    }[keyof API]
  >
) => {
  [K in keyof API]: (
    args: ActionArgs<any, any, any>
  ) => ReturnType<AnyXStateAction>
}

export type EffectActions = Record<string, EffectAction>
const isAssignEffect = (
  fn: any
): fn is EffectAction & { [AssignEffectSymbol]: AssignEffectSymbol } =>
  fn[AssignEffectSymbol] === AssignEffectSymbol

export const createEffectActions: CreateEffectActions = (api, runtime) => {
  const result = {} as {
    [k in keyof typeof api]: AnyXStateAction
  }

  const run = Runtime.runPromise(runtime)
  const runSync = Runtime.runSync(runtime)

  let action: AnyXStateAction

  for (const key in api) {
    const fn = api[key]

    if (isAssignEffect(fn)) {
      action = assign((args) => {
        let stateId: string = key
        try {
          stateId = args.self.getSnapshot().value
          if (stateId !== 'string') {
            stateId = JSON.stringify(stateId)
            // todo. What do we prefer?
            // .replace(/\{|\}|"/g, '')
            // .replace(/,/g, '+')
          }
        } catch (e) {}
        return pipe(
          fn(args),
          Effect.tapErrorCause((cause) =>
            Effect.logError('Assign effect error', cause)
          ),
          Effect.withLogSpan(key),
          runSync
        )
      })
    } else {
      action = async (args: ActionArgs<any, any, any>) => {
        try {
          let stateId: string = key
          try {
            stateId = args.self.getSnapshot().value
            if (stateId !== 'string') {
              stateId = JSON.stringify(stateId)
              // todo. What do we prefer?
              // .replace(/\{|\}|"/g, '')
              // .replace(/,/g, '+')
            }
          } catch (e) {}

          const result = await run(
            pipe(
              fn(args),
              Effect.withLogSpan(stateId),
              Effect.tapErrorCause((cause) =>
                Effect.logError('Action error', cause)
              )
            )
          )
          return result
        } catch (e) {
          console.error('[effect-actions] unhandled exception!', e)
        }
      }
    }

    result[key] = action
  }
  return result
}
