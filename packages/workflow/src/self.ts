import { Cause, Effect, Exit, pipe } from 'effect'
import {
  Trigger,
  ApplicationFailure,
  ExternalWorkflowHandle,
  WorkflowNotFoundError as TemporalWorkflowNotFoundError,
  getExternalWorkflowHandle,
  continueAsNew,
} from '@temporalio/workflow'
import * as S from '@effect/schema/Schema'
import {
  ExternalWorkflowNotFoundError,
  SignalExternalWorkflowError,
  SignalExternalWorkflowOutput,
} from './signal-external-workflow'
import { WorkflowInfo } from './workflow-info'
import { toApplicationFailure } from './errors'

export type Self<Db, Signals = any> = {
  id: string
  close: (exit: Exit.Exit<any, any>) => Effect.Effect<any, any, any>
  isContinueAsNewSuggested: () => Effect.Effect<never, never, boolean>
  continueAsNew: (state: Db) => Effect.Effect<never, never, never>
  signalWorkflow: <K extends keyof Signals>(
    workflowId: string,
    signalName: K,
    data: S.Schema.To<Signals[K]>
  ) => Effect.Effect<
    never,
    SignalExternalWorkflowError,
    SignalExternalWorkflowOutput
  >
}

export const make = <
  Db extends Record<string, any>,
  Signals extends Record<string, S.Schema<never, any>>
>(
  blocker: Trigger<any>,
  workflowInfo: WorkflowInfo
): Self<Db, Signals> => {
  return {
    get id() {
      return workflowInfo().workflowId
    },
    signalWorkflow: <K extends keyof Signals>(
      workflowId: string,
      signalName: K,
      data: S.Schema.To<Signals[K]>
    ): Effect.Effect<
      never,
      SignalExternalWorkflowError,
      SignalExternalWorkflowOutput
    > =>
      pipe(
        Effect.Do,
        Effect.bind('handle', () =>
          pipe(
            Effect.try<
              ExternalWorkflowHandle,
              TemporalWorkflowNotFoundError | unknown
            >({
              try: () => getExternalWorkflowHandle(workflowId),
              catch: (e) => {
                if (e instanceof TemporalWorkflowNotFoundError) {
                  return Effect.fail(
                    new ExternalWorkflowNotFoundError({
                      workflowId,
                    })
                  )
                }
                return Effect.fail(e)
              },
            })
          )
        ),
        Effect.tap(({ handle }) =>
          Effect.tryPromise(() => handle.signal(signalName as string, data))
        ),
        Effect.map(({ handle }) => ({
          workflowId: handle.workflowId,
          runId: handle.runId!,
        }))
      ),
    close: (exit: Exit.Exit<any, any>) =>
      pipe(
        Effect.sync(() => {
          if (Exit.isFailure(exit)) {
            if (Cause.isDie(exit.cause)) {
              return blocker.reject(
                ApplicationFailure.create({
                  type: 'Exit',
                  message: 'Fail',
                  cause: new Error(exit.cause.toString()),
                  details: [exit],
                  nonRetryable: true,
                })
              )
            }
            if (Cause.isFailure(exit.cause)) {
              return blocker.reject(
                toApplicationFailure(
                  exit.cause._tag === 'Fail' ? exit.cause.error : exit.cause
                )
              )
            }
          }

          return blocker.resolve(exit)
        }),
        Effect.flatMap(() => Effect.interrupt)
      ),

    continueAsNew: (state: Db) =>
      Effect.tryPromise({
        try: (): Promise<never> =>
          continueAsNew(state).catch((e) => blocker.reject(e) as never),
        catch: (e) => e as never,
      }),

    isContinueAsNewSuggested: () =>
      Effect.succeed(workflowInfo().continueAsNewSuggested),
  }
}

export const of = <Db, Signals>(self: Self<Db, Signals>) => self

export const Self = { make, of }
