import { pipe } from 'effect/Function'
import { FeatureFlagClient } from '@diachronic/feature-flag-client'
import { Effect } from 'effect'
import * as S from '@effect/schema/Schema'

export class TaskQueueNotFound extends S.TaggedError<TaskQueueNotFound>()(
  'TaskQueueNotFound',
  {
    message: S.String,
    workflowName: S.String,
    context: S.Any,
  }
) {}

/**
 * Returns the task queue for {workflowName} that {context} should start on or an error.
 * @param workflowName
 * @param context
 */
export const getTaskQueueOrFail = (
  workflowName: string,
  context: { userId: string }
) =>
  pipe(
    Effect.flatMap(FeatureFlagClient, (client) =>
      client.getWorkflowTaskQueue({ workflowName, context, defaultValue: '' })
    ),
    Effect.filterOrFail(
      (x) => x === '',
      () =>
        new TaskQueueNotFound({
          message: `Could not determine the task queue for ${workflowName}`,
          workflowName,
          context,
        })
    )
  )

/**
 * Returns the task queue for {workflowName} that {context} should start on.
 * If something goes wrong, returns {defaultValue}
 * @param workflowName
 * @param context
 * @param defaultValue
 */
export const getTaskQueue = (
  workflowName: string,
  context: { userId: string; orgId?: string },
  defaultValue: string
) =>
  pipe(
    Effect.flatMap(FeatureFlagClient, (client) =>
      client.getWorkflowTaskQueue({
        workflowName,
        context,
        defaultValue,
      })
    ),
    Effect.catchAllCause((e) =>
      pipe(
        Effect.logError('Error getting task queue feature flag', e),
        Effect.flatMap(() => Effect.succeed(defaultValue))
      )
    )
  )

export const taskQueueFromBodyOrFeatureFlag = (body: any) =>
  Effect.if(typeof body.taskQueue === 'string', {
    onTrue: () =>
      pipe(
        Effect.logDebug('Using provided taskQueue'),
        Effect.annotateLogs({ taskQueue: body.taskQueue }),
        Effect.flatMap(() => Effect.succeed(body))
      ),
    onFalse: () =>
      pipe(
        Effect.logDebug('Getting taskQueue from feature flag'),
        Effect.flatMap(() =>
          getTaskQueueOrFail(body.workflowType, {
            userId: body.workflowId,
            // @ts-expect-error
            isTest: body.searchAttributes?.isTest,
          })
        ),
        Effect.map((x) => ({
          ...body,
          taskQueue: x,
        })),
        Effect.tapError(Effect.logError)
      ),
  })
