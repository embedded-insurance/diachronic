import * as S from '@effect/schema/Schema'
import { TemporalClient, signal } from '@effect-use/temporal-client'
import { pipe } from 'effect/Function'
import * as Effect from 'effect/Effect'
import { AsyncWorkflowListIterable } from '@temporalio/client'

export const signalMigrate = (workflowId: string, newQueue: string) => {
  const signalArgs = {
    workflowId,
    signal: 'diachronic.v1.migrate',
    signalArgs: [{ taskQueue: newQueue }],
  }

  return pipe(
    TemporalClient,
    Effect.flatMap((client) => {
      console.log(`signaling ${workflowId} with ${JSON.stringify(signalArgs)}`)
      return signal(signalArgs)
    })
  )
}

export const getWorkflowHandles = (workflowType: string, taskQueue: string) => {
  return pipe(
    TemporalClient,
    Effect.map((client) => {
      const result: AsyncWorkflowListIterable = client.workflow.list({
        query: `WorkflowType = '${workflowType}' and TaskQueue='${taskQueue}' and ExecutionStatus = 'Running'`,
      })
      return result
    })
  )
}

export const getIds = async (
  l: AsyncWorkflowListIterable
): Promise<string[]> => {
  const result = []
  for await (const handle of l) {
    result.push(handle.workflowId)
  }
  return result
}

const TemporalQueryParams = S.Struct({
  taskQueue: S.optional(S.String),
  workflowName: S.optional(S.String),
  startTime: S.optional(S.String),
  endTime: S.optional(S.String),
  executionStatus: S.optional(S.Union(S.Literal('Running'), S.String)),
})
export type TemporalQueryParams = S.Schema.Type<typeof TemporalQueryParams>

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1)

const mapQuery = (args: {
  taskQueue?: string | undefined
  workflowName?: string | undefined
  startTime?: string | undefined
  endTime?: string | undefined
  executionStatus?: 'Running' | string | undefined
}): string =>
  Object.entries(args)
    .map(([k, v]) =>
      k === 'workflowName' ? `WorkflowType = '${v}'` : `${capitalize(k)}="${v}"`
    )
    .join(' AND ')!

export const listWorkflowIds = (args: TemporalQueryParams) =>
  Effect.flatMap(TemporalClient, (client) => {
    const query = mapQuery(args)
    return pipe(
      Effect.logDebug(`Running Temporal query: ${query}`),
      Effect.flatMap(() =>
        Effect.tryPromise(async () => {
          let results = []
          for await (const workflowHandle of client.workflow.list({ query })) {
            results.push(workflowHandle.workflowId)
          }
          return results
        })
      ),
      Effect.withLogSpan('listWorkflowIds')
    )
  })

export const migrate = async (
  workflowType: string,
  oldQueue: string,
  newQueue: string
) => {
  pipe(
    getWorkflowHandles(workflowType, oldQueue),
    Effect.flatMap((l) => Effect.tryPromise(() => getIds(l))),
    Effect.map((ids) => ids.map((id) => signalMigrate(id, newQueue))),
    Effect.flatMap((x) => Effect.all(x)),
    Effect.scoped
  )
}
