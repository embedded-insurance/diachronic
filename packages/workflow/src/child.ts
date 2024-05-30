import {
  ChildWorkflowOptions,
  executeChild,
  startChild,
  WorkflowExecutionAlreadyStartedError as TemporalWorkflowExecutionAlreadyStartedError,
  getExternalWorkflowHandle,
} from '@temporalio/workflow'
import * as Effect from 'effect/Effect'
import * as S from '@effect/schema/Schema'
import { pipe } from 'effect/Function'
import { WorkflowExecutionAlreadyStartedError } from '@effect-use/temporal-client/dist/errors'
import { WorkflowDef } from './workflow'

export const makeChildWorkflows = <
  Schema extends Record<
    string,
    {
      name: string
      input: S.Schema<any>
      output: S.Schema<any>
      error: S.Schema<any>
      defaultOptions: ChildWorkflowOptions
    }
  >
>(
  schema: Schema
) =>
  Object.fromEntries(
    Object.entries(schema).map(([k, v]) => [
      k,
      (
        args: S.Schema.Type<(typeof v)['input']>,
        options?: ChildWorkflowOptions
      ) =>
        Effect.tryPromise(() =>
          executeChild(k, {
            ...v.defaultOptions,
            ...options,
            args: [args],
          })
        ),
    ])
  ) as {
    [K in keyof Schema]: (
      args: S.Schema.Type<Schema[K]['input']>,
      options?: ChildWorkflowOptions
    ) => Effect.Effect<
      S.Schema.Type<Schema[K]['output']>,
      S.Schema.Type<Schema[K]['error']>
    >
  }

export const makeChildWorkflows2 = <
  Schema extends Record<
    string,
    {
      name: string
      input: S.Schema<any>
      output: S.Schema<any>
      error: S.Schema<any>
      ['temporal.workflow']: {
        defaultTemporalOptions: ChildWorkflowOptions
        signals?: Record<string, S.Schema<any>>
      }
    }
  >
>(
  schema: Schema
) =>
  Object.fromEntries(
    Object.entries(schema).map(([k, v]) => [
      k,
      {
        executeChild: (
          args: S.Schema.Type<(typeof v)['input']>,
          options?: { temporalOptions?: ChildWorkflowOptions }
        ) =>
          pipe(
            Effect.tryPromise(() =>
              executeChild(k, {
                ...v['temporal.workflow'].defaultTemporalOptions,
                ...options?.temporalOptions,
                args: [args],
              })
            ),
            Effect.mapError((e) => {
              if (e instanceof TemporalWorkflowExecutionAlreadyStartedError) {
                return new WorkflowExecutionAlreadyStartedError(e)
              }
              return e
            })
          ),
        /// This can cancel any workflow, not just the child that was spawned.
        // https://github.com/temporalio/sdk-typescript/issues/740
        // It may be better to create child workflows with a cancellation scope "and then cancel the scope"
        // The cancellation scope api is confusing however and uses uncaught errors as its api contract
        // cancel: (args: { workflowId: string; runId?: string }) =>
        //   pipe(
        //     Effect.logDebug('Canceling workflow'),
        //     Effect.annotateLogs({
        //       workflowId: args.workflowId,
        //       runId: args.runId,
        //     }),
        //     Effect.flatMap(() =>
        //       Effect.tryPromise(() =>
        //         getExternalWorkflowHandle(args.workflowId, args.runId).cancel()
        //       )
        //     )
        //   ),
        startChild: (
          args: S.Schema.Type<(typeof v)['input']>,
          options?: { temporalOptions?: ChildWorkflowOptions }
        ) =>
          pipe(
            Effect.tryPromise(() =>
              startChild(k, {
                ...v['temporal.workflow'].defaultTemporalOptions,
                ...options?.temporalOptions,
                args: [args],
              }).then((x) => ({
                workflowId: x.workflowId,
                firstExecutionRunId: x.firstExecutionRunId,

                // This provides a typed signal function for the workflow based on its signals annotation
                signal: <
                  K extends keyof (typeof v)['temporal.workflow']['signals']
                >(
                  signal: K,
                  args: (typeof v)['temporal.workflow']['signals'] extends undefined
                    ? never
                    : S.Schema.Type<
                        (typeof v)['temporal.workflow']['signals'][K]
                      >
                ) => Effect.tryPromise(() => x.signal(signal, args)),

                result: () =>
                  Effect.tryPromise(
                    () =>
                      x.result() as Promise<S.Schema.Type<(typeof v)['output']>>
                  ),
                // This binds the function to the execution that was started
                // vs a generic cancel that would cancel any workflow, not necessarily a child of this one.
                // A child workflow handle already has methods like signal that are not serializable
                cancel: () =>
                  pipe(
                    Effect.logDebug('Canceling workflow'),
                    Effect.annotateLogs({
                      workflowId: x.workflowId,
                      runId: x.firstExecutionRunId,
                    }),
                    Effect.flatMap(() =>
                      Effect.tryPromise(() =>
                        getExternalWorkflowHandle(
                          x.workflowId,
                          x.firstExecutionRunId
                        ).cancel()
                      )
                    )
                  ),
              }))
            ),
            Effect.mapError((e) => {
              if (e instanceof TemporalWorkflowExecutionAlreadyStartedError) {
                return new WorkflowExecutionAlreadyStartedError(e)
              }
              if (e instanceof Error) {
                return { _tag: 'Error', message: e.message, stack: e.stack }
              }
              return e
            })
          ),
      },
    ])
  ) as {
    [K in keyof Schema]: {
      executeChild: (
        args: S.Schema.Type<Schema[K]['input']>,
        options?: { temporalOptions?: ChildWorkflowOptions }
      ) => Effect.Effect<
        S.Schema.Type<Schema[K]['output']>,
        WorkflowExecutionAlreadyStartedError | S.Schema.Type<Schema[K]['error']>
      >
      startChild: (
        args: S.Schema.Type<Schema[K]['input']>,
        options?: { temporalOptions?: ChildWorkflowOptions }
      ) => Effect.Effect<
        {
          workflowId: string
          firstExecutionRunId?: string
          result: () => Effect.Effect<
            S.Schema.Type<Schema[K]['output']>,
            S.Schema.Type<Schema[K]['error']>
          >
          signal: <K2 extends keyof Schema[K]['temporal.workflow']['signals']>(
            signal: K2,
            args: Schema[K]['temporal.workflow']['signals'] extends Record<
              string,
              S.Schema<any>
            >
              ? S.Schema.Type<Schema[K]['temporal.workflow']['signals'][K2]>
              : never
          ) => Effect.Effect<unknown, unknown>
          cancel: () => Effect.Effect<void, unknown>
        },
        WorkflowExecutionAlreadyStartedError | unknown
      >
    }
  }
// export type ChildWorkflowHandle<T extends WorkflowDef> = {
export type EffectWorkflowAPI<T extends WorkflowDef> = {
  executeChild: (
    args: S.Schema.Type<T['input']>,
    options?: { temporalOptions?: ChildWorkflowOptions }
  ) => Effect.Effect<
    S.Schema.Type<T['output']>,
    WorkflowExecutionAlreadyStartedError | S.Schema.Type<T['error']>
  >
  startChild: (
    args: S.Schema.Type<T['input']>,
    options?: { temporalOptions?: ChildWorkflowOptions }
  ) => Effect.Effect<
    {
      workflowId: string
      firstExecutionRunId?: string
      result: () => Effect.Effect<
        S.Schema.Type<T['output']>,
        S.Schema.Type<T['error']>
      >
      signal: <K2 extends keyof T['temporal.workflow']['signals']>(
        signal: K2,
        args: T['temporal.workflow']['signals'] extends Record<
          string,
          S.Schema<any>
        >
          ? S.Schema.Type<T['temporal.workflow']['signals'][K2]>
          : never
      ) => Effect.Effect<unknown, unknown>
      cancel: () => Effect.Effect<void, unknown>
    },
    WorkflowExecutionAlreadyStartedError | unknown
  >
}

export type EffectWorkflowAPIs<T extends Record<string, WorkflowDef>> = {
  [K in keyof T]: EffectWorkflowAPI<T[K]>
}

export type EffectWorkflowHandle<T extends WorkflowDef> = {
  workflowId: string
  firstExecutionRunId?: string
  result: () => Effect.Effect<unknown, unknown>
  signal: <K2 extends keyof T['temporal.workflow']['signals']>(
    signal: K2,
    args: T['temporal.workflow']['signals'] extends Record<
      string,
      S.Schema<any>
    >
      ? S.Schema.Type<T['temporal.workflow']['signals'][K2]>
      : never
  ) => Effect.Effect<unknown, unknown>
  cancel: () => Effect.Effect<void, unknown>
}
