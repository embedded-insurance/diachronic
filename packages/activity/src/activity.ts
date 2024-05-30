import { Effect } from 'effect'
import {
  EffectDef,
  EffectDefWith,
  ErrorType,
  InputType,
  OutputType,
} from './single'
import { scheduleActivity, ActivityOptions } from '@temporalio/workflow'
import * as R from 'ramda'
import { asEffect, asEffectGroup } from './effect'
import { defSchema } from './multi'
import * as S from '@effect/schema/Schema'
import * as Runtime from 'effect/Runtime'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Scope from 'effect/Scope'
import * as Exit from 'effect/Exit'
import { getFailure, toApplicationFailure } from '@diachronic/workflow/errors'
import { ParseResult } from '@effect/schema'
import { TemporalLogLayer } from '@diachronic/workflow/workflow-logging'

const key = 'temporal.activity' as const
type Key = typeof key

type ActivityConfig = {
  // Optional override for the name of the activity used by temporal
  // when not specified the basic `name` property from the definition will be used
  name?: string
  defaultOptions: ActivityOptions
}
export type ActivityDef = EffectDefWith<{
  [key]: ActivityConfig
}>

/**
 * Represents an activity as data
 */
export const activityDef = <
  const A extends EffectDefWith<
    Partial<{
      [key]: Partial<ActivityConfig>
    }>
  >
>(
  a: A
) => {
  // @ts-ignore
  a['temporal.activity'] = a['temporal.activity'] || {}
  // @ts-ignore
  a['temporal.activity'].defaultOptions = a['temporal.activity']
    .defaultOptions || {
    scheduleToCloseTimeout: '15s',
  }
  return a as {
    name: A['name']
    input: A['input']
    output: A['output']
    error: A['error']
    ['temporal.activity']: {
      defaultOptions: ActivityOptions
    }
  }
}

export const defGroup = defSchema<ActivityDef>()

const createExtension =
  <T, const K extends string>(k: K) =>
  (f: <const Def extends EffectDef>(a: Def) => T) =>
  <const Def extends EffectDef>(a: Def) =>
    ({
      ...a,
      [k]: f(a),
    } as const as Def & { [K in typeof k]: T })

export const addActivityDef = createExtension<ActivityConfig, Key>(key)

export class ActivityInputSchemaError extends S.TaggedError<ActivityInputSchemaError>()(
  'ActivityInputSchemaError',
  {
    activityName: S.String,
    message: S.optional(S.String, {
      default: () => `Activity called with wrong arguments`,
    }),
    error: S.instanceOf(ParseResult.ParseError),
  }
) {
  public nonRetryable = true
}

export class ActivityOutputSchemaError extends S.TaggedError<ActivityOutputSchemaError>()(
  'ActivityOutputSchemaError',
  {
    activityName: S.String,
    message: S.optional(S.String, {
      default: () => `Activity returned unexpected output`,
    }),
    error: S.instanceOf(ParseResult.ParseError),
  }
) {
  public nonRetryable = true
}

/**
 * Returns a function that invokes the activity specified by sch
 * @param schema
 * @param options
 * @param scheduleActivityFn
 */
export const toInvokeActivity =
  <A extends ActivityDef>(
    schema: A,
    options?: ActivityOptions,
    scheduleActivityFn: typeof scheduleActivity = scheduleActivity
  ) =>
  (
    activityInput: InputType<A>,
    runtimeOptions?: ActivityOptions
  ): Effect.Effect<OutputType<A>, ErrorType<A>> =>
    pipe(
      Effect.tryPromise(() =>
        scheduleActivityFn(
          schema['temporal.activity'].name || schema.name,
          [activityInput],
          R.mergeDeepRight(
            R.mergeDeepRight(
              schema['temporal.activity'].defaultOptions,
              options || {}
            ),
            runtimeOptions || {}
          )
        )
      ),
      Effect.mapError((e) => {
        // Try to get our error data
        // This is expected to be an Effect failure stored in the first element of the ApplicationFailure details
        // This allows error handling to be done in the workflow code with catchTags, etc.
        try {
          // @ts-expect-error
          const data = e?.error?.cause?.details?.[0]
          if (data) {
            return data
          } else {
            return e // orig
          }
        } catch (e2) {
          return e // orig
        }
      })
    ) as Effect.Effect<OutputType<A>, ErrorType<A>>

export const implement = asEffect

export const implementGroup = asEffectGroup

export type GroupDef = Record<
  string,
  EffectDefWith<{
    [key]: ActivityConfig
  }>
>

export type MakeActivitiesAsync = <
  Schema extends Record<string, ActivityDef>,
  API extends {
    [K in keyof Schema]: (
      args: S.Schema.Type<Schema[K]['input']>
      // should any be unknown or something?
    ) => Effect.Effect<
      S.Schema.Type<Schema[K]['output']>,
      S.Schema.Type<Schema[K]['error']>,
      any
    >
  }
>(
  schema: Schema,
  api: API,
  runtime: Promise<{
    runtime: Runtime.Runtime<
      Effect.Effect.Context<{ [K in keyof API]: ReturnType<API[K]> }[keyof API]>
    >
    close: Effect.Effect<void>
  }>
) => Promise<{
  [K in keyof API]: (
    args: Parameters<API[K]>[0]
  ) => Promise<Effect.Effect.Success<ReturnType<API[K]>>>
}>

export type MakeActivities = <
  Schema extends Record<string, ActivityDef>,
  API extends {
    [K in keyof Schema]: (
      args: S.Schema.Type<Schema[K]['input']>
    ) => Effect.Effect<
      S.Schema.Type<Schema[K]['output']>,
      S.Schema.Type<Schema[K]['error']>,
      any
    >
  }
>(
  schema: Schema,
  api: API,
  runtime: Runtime.Runtime<
    Effect.Effect.Context<{ [K in keyof API]: ReturnType<API[K]> }[keyof API]>
  >
) => {
  [K in keyof API]: (
    args: Parameters<API[K]>[0]
  ) => Promise<Effect.Effect.Success<ReturnType<API[K]>>>
}
export const makeActivities: MakeActivities = (schema, api, runtime) => {
  // console.log('[makeActivities]', { schema, api, runtime })
  const activities = {} as {
    [K in keyof typeof api]: (
      args: Parameters<(typeof api)[K]>[0]
    ) => Promise<Effect.Effect.Success<ReturnType<(typeof api)[K]>>>
  }
  // FIXME. hangs when activity is a sync effect
  const runner = Runtime.runPromise(runtime)

  for (const activityName in api) {
    const activity = async (input: any) => {
      try {
        return await pipe(
          api[activityName](input),
          Effect.tap((result) => Effect.logDebug(result)),
          Effect.tapErrorCause((cause) =>
            Effect.logDebug('Activity fail cause', cause)
          ),
          Effect.withLogSpan(activityName),
          // Effect.mapError((e) => {
          //   if (isSchemaError(e)) {
          //     const formatted = formatSchemaErrors(e)
          //     return ApplicationFailure.create({
          //       type: e._tag,
          //       nonRetryable: true,
          //       message: formatted,
          //       details: [e.errors],
          //       cause: e,
          //     })
          //   }
          //   return e
          // }),
          Effect.withLogSpan('diachronic.activity-runner'),
          runner
        )
      } catch (e) {
        // Leave as-is if already an ApplicationFailure. We don't expect this in the general case
        if ((e as any)?.name === 'ApplicationFailure') {
          throw e
        }
        const failure = getFailure(e)
        const toThrow = toApplicationFailure(failure)
        throw toThrow

        // // When an Effect failure, map it to a Temporal ApplicationFailure and rethrow
        // // @ts-expect-error
        // if (e?.[Symbol.for('effect/Runtime/FiberFailure/Cause')]) {
        //   // @ts-expect-error
        //   const err = e?.[Symbol.for('effect/Runtime/FiberFailure/Cause')].error
        //   // @ts-expect-error
        //   throw ApplicationFailure.fromError(e, {
        //     type: err?._tag,
        //     message: err?.message,
        //     cause: err as Error,
        //     nonRetryable: err?.nonRetryable,
        //     details:
        //       // @ts-expect-error
        //       err && err._tag && err.toJSON ? [e.toJSON()] : undefined,
        //   })
        // }

        // Otherwise rethrow
        // throw new UnknownException(e)
      }
    }

    Object.defineProperty(activity, 'name', {
      value: activityName,
    })

    // @ts-expect-error
    activities[activityName] = activity
  }
  return activities
}

export const makeActivitiesAsync: MakeActivitiesAsync = async (
  schema,
  api,
  runtimePromise
) => {
  const { runtime, close } = await runtimePromise
  process.on('SIGINT', () => {
    console.log('SIGINT')
    Effect.runSync(close)
  })
  return makeActivities(schema, api, runtime)
}

export const makeActivitiesRuntime = <E, A>(
  layer: Layer.Layer<A, E, Scope.Scope> | Layer.Layer<A, E>,
  logLayer: Layer.Layer<never> = TemporalLogLayer('Info')
): Promise<{
  runtime: Runtime.Runtime<A>
  close: Effect.Effect<void>
}> =>
  pipe(
    Effect.Do,
    Effect.bind('scope', () => Scope.make()),
    Effect.bind('runtime', ({ scope }) =>
      pipe(layer, Layer.merge(logLayer), Layer.toRuntime, Scope.extend(scope))
    ),
    Effect.map(({ runtime, scope }) => ({
      runtime,
      close: Scope.close(scope, Exit.void),
    })),
    Effect.tapErrorCause(Effect.logError),
    Effect.runPromise
  )
