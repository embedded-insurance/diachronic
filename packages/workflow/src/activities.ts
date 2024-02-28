import * as R from 'ramda'
import * as Effect from 'effect/Effect'
import * as S from '@effect/schema/Schema'
import { ActivityOptions, scheduleActivity } from '@temporalio/workflow'
import {
  ActivityDef,
  GroupDef,
  toInvokeActivity,
} from '@diachronic/activity/activity'
import {
  addGroupDecoder,
  BadInput,
  BadOutput,
} from '@diachronic/activity/effect'
import * as PR from '@effect/schema/ParseResult'
import { UnknownException } from 'effect/Cause'
import { EffectImpl } from '@diachronic/activity/single'

export const mapGroupToScheduleActivities = <Group extends GroupDef>(
  group: Group,
  groupOptions?: { defaults?: ActivityOptions } & Partial<{
    [K in keyof Group]: ActivityOptions
  }>,
  scheduleActivityFn: typeof scheduleActivity = scheduleActivity
) =>
  Object.fromEntries(
    Object.entries(group).map(
      ([k, sch]) =>
        [
          k,
          toInvokeActivity(
            sch,
            R.mergeDeepRight(
              groupOptions?.defaults || {},
              groupOptions?.[k] || {}
            ),
            scheduleActivityFn
          ),
        ] as const
    )
  ) as {
    [Fn in keyof Group]: (
      args: S.Schema.To<Group[Fn]['input']>,
      runtimeOptions?: ActivityOptions
    ) => Effect.Effect<
      never,
      S.Schema.To<Group[Fn]['error']>,
      S.Schema.To<Group[Fn]['output']>
    >
  }

type FnObjectGroup = Record<
  string,
  EffectImpl<ActivityDef, any> & { ['diachronic.meta']: ActivityDef }
>

// This is useless without a compiler/bundler that strips the dependencies of
// the functions that are referred to here, or a way of running workflows that
// effectively ignores any side-effectful library code.
// We may be able to do this in the equivalent of Temporal's workerOptions.bundlerOptions.ignoreModules
// Until then, activity definition code must exist on disk independently of the implementation of the definition
// :(
export const intoScheduleActivities = <Group extends FnObjectGroup>(
  group: Group,
  groupOptions?: { defaults?: ActivityOptions } & Partial<{
    [K in keyof Group]: ActivityOptions
  }>
) =>
  Object.fromEntries(
    Object.entries(group).map(
      ([k, sch]) =>
        [
          k,
          toInvokeActivity(
            sch['diachronic.meta'],
            R.mergeDeepRight(
              groupOptions?.defaults || {},
              groupOptions?.[k] || {}
            )
          ),
        ] as const
    )
  ) as {
    [Fn in keyof Group]: (
      args: S.Schema.From<Group[Fn]['diachronic.meta']['input']>
    ) => Effect.Effect<
      never,
      S.Schema.To<Group[Fn]['diachronic.meta']['error']>,
      S.Schema.To<Group[Fn]['diachronic.meta']['output']>
    >
  }

export const makeWorkflowActivities = <
  Schemas extends Record<string, Record<string, ActivityDef>>
>(
  schemas: Schemas,
  options: {
    [Namespace in keyof Schemas]?: {
      [Fn in keyof Schemas[Namespace] | 'defaults']?: ActivityOptions
    }
  } = {}
) =>
  Object.entries(schemas).reduce(
    (a, [ns, schema]) => ({
      ...a,
      [ns]: addGroupDecoder(schema)(
        mapGroupToScheduleActivities(
          // @ts-expect-error
          schema,
          options[ns]
        )
      ),
    }),
    {} as {
      [Namespace in keyof Schemas]: {
        [Fn in keyof Schemas[Namespace]]: (
          args: S.Schema.From<Schemas[Namespace][Fn]['input']>
        ) => Effect.Effect<
          never,
          S.Schema.To<Schemas[Namespace][Fn]['error']> extends { _tag: string }
            ?
                | S.Schema.To<Schemas[Namespace][Fn]['error']>
                | PR.ParseError
                | BadInput
                | BadOutput
                | UnknownException
            : BadInput | BadOutput | PR.ParseError | UnknownException,
          S.Schema.To<Schemas[Namespace][Fn]['output']>
        >
      }
    }
  )
