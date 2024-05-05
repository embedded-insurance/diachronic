import type {
  WorkflowHandleWithSignaledRunId,
  WorkflowHandle,
} from '@temporalio/client'
import { Trigger } from '@diachronic/util/trigger'
import { getSnapshotQueryName, WorkflowSnapshot } from '../src'

/**
 *
 * @category helper
 * @param workflowHandle
 * @param condition
 * @param pollingIntervalMs
 */
export const waitForWorkflowCondition = async (
  workflowHandle: WorkflowHandleWithSignaledRunId<any>,
  condition: (snapshot: WorkflowSnapshot) => boolean,
  pollingIntervalMs: number = 500
): Promise<WorkflowSnapshot> => {
  const t = new Trigger<WorkflowSnapshot>()
  const int = setInterval(async () => {
    const result = await workflowHandle.query<WorkflowSnapshot>(
      getSnapshotQueryName
    )
    if (condition(result as any)) {
      console.log('condition met')
      clearInterval(int)
      t.resolve(result)
      return
    }
    console.log('condition not met')
  }, pollingIntervalMs)
  return (await t) as WorkflowSnapshot
}

export const untilTrue = async (
  pred: () => Promise<any>,
  interval: number = 500,
  maxAttempts: number = Infinity
) => {
  const t = new Trigger()
  const int = setInterval(async () => {
    const result = await pred()
    if (result) {
      clearInterval(int)
      t.resolve(result)
      return
    }
    if (maxAttempts-- <= 0) {
      clearInterval(int)
      t.reject('max attempts reached')
    }
  }, interval)
  return await t
}

// Workflow migrated when the current run id does not equal the initial run id
export const awaitMigrated = async (
  initialRunId: string,
  wf: WorkflowHandle<any>
): Promise<any> =>
  await untilTrue(async () => {
    const currentRunId = await wf.describe().then((x) => x.runId)
    return currentRunId !== initialRunId
  })
