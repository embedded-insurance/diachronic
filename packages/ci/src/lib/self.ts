import { Cause, Effect, Exit, pipe } from 'effect'
import {
  Trigger,
  ApplicationFailure,
  // WorkflowInfo,
  ExternalWorkflowHandle,
} from '@temporalio/workflow'
import * as wf from '@temporalio/workflow'
import * as S from '@effect/schema/Schema'
import {
  ExternalWorkflowNotFoundError,
  SignalExternalWorkflowError,
  SignalExternalWorkflowOutput,
} from '@diachronic/workflow/signal-external-workflow'
import { WorkflowNotFoundError as TemporalWorkflowNotFoundError } from '@temporalio/workflow'

export type Self<Db, Signals = any> = {
  close: (exit: Exit.Exit<any, any>) => Effect.Effect<any, any, any>
  isContinueAsNewSuggested: () => Effect.Effect<boolean>
  continueAsNew: (state: Db) => Effect.Effect<never>
  signalWorkflow: <K extends keyof Signals>(
    workflowId: string,
    signalName: K,
    data: Signals[K]
  ) => Effect.Effect<SignalExternalWorkflowOutput, SignalExternalWorkflowError>
}

export const make = <
  Db extends Record<string, any>,
  Signals extends Record<string, S.Schema<any, any>>
>(
  blocker: Trigger<any>
  // workflowInfo: () => WorkflowInfo
): Self<Db, Signals> => {
  return {
    signalWorkflow: <K extends keyof Signals>(
      workflowId: string,
      signalName: K,
      data: Signals[K]
    ): Effect.Effect<SignalExternalWorkflowOutput, SignalExternalWorkflowError> =>
      pipe(
        Effect.Do,
        Effect.bind('handle', () =>
          pipe(
            Effect.try<
              ExternalWorkflowHandle,
              TemporalWorkflowNotFoundError | unknown
            >({
              try: () => wf.getExternalWorkflowHandle(workflowId),
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
          return blocker.reject(exit)
        }
        return blocker.resolve(exit)
      }),

    continueAsNew: (state: Db) =>
      Effect.tryPromise({
        try: (): Promise<never> =>
          wf.continueAsNew(state).catch((e) => blocker.reject(e) as never),
        catch: (e) => e as never,
      }),

    isContinueAsNewSuggested: () =>
      Effect.succeed(wf.workflowInfo().continueAsNewSuggested),
  };
}

export const of = <Db, Signals>(self: Self<Db, Signals>) => self

export const Self = { make, of }
