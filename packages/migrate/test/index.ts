import * as R from 'ramda'
import * as fc from 'fast-check'
import { TestWorkflowEnvironment } from '@temporalio/testing'
import {
  Runtime,
  Worker,
  WorkerOptions,
  DefaultLogger,
} from '@temporalio/worker'
import { WorkflowHandleWithSignaledRunId } from '@temporalio/client'
import { Trigger } from '@diachronic/util/trigger'
import { getArbitrary } from '@diachronic/util/arbitrary'
import * as workflow1info from './lib/workflow1info'
import { CustomInterpreter, getTimeLeft } from '../src/interpreter'
import { isXStateAfterId, XStateTimerId } from '../src/analysis'
import { getSnapshotQueryName, WorkflowSnapshot } from '../src'
import { machine } from './lib/workflow1info'
import { waitFor, AnyState } from 'xstate'
import { migrateSignalName } from '../src/can-migrate'
import { loggerSink } from '@diachronic/workflow/workflow-logging'

jest.setTimeout(200_000)

/**
 *
 * @category helper
 * @param workflowHandle
 * @param condition
 * @param pollingIntervalMs
 */
const waitForWorkflowCondition = async (
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

const untilTrue = async (
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

beforeAll(async () => {
  Runtime.install({
    logger: new DefaultLogger('WARN'),
  })
})
test('workflow 1', async () => {
  const testEnv = await TestWorkflowEnvironment.createTimeSkipping()
  let initialRunId: string

  const worker1Args: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: 'initial',
    workflowsPath: require.resolve('./lib/workflow1-entry'),
  }

  const worker1 = await Worker.create(worker1Args)
  const workflowRun = await testEnv.client.workflow.signalWithStart(
    'theWorkflow',
    {
      taskQueue: worker1Args.taskQueue,
      workflowId: '42',
      signal: 'hey',
      signalArgs: [''],
      followRuns: true,
    }
  )
  initialRunId = workflowRun.signaledRunId
  const t1 = new Trigger()
  // @ts-expect-error
  const worker1Run = worker1.runUntil(t1)

  const state = await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => snapshot.state === 'heyed'
  )

  const timers = Object.values(state.timers)
  expect(timers.length).toEqual(1)
  expect(timers[0].delay).toEqual(workflow1info.TIMER_DELAY)

  const timeLeft = getTimeLeft(timers[0], await testEnv.currentTimeMs())

  expect(timeLeft).toBeGreaterThan(0)
  expect(timeLeft).toBeLessThan(workflow1info.TIMER_DELAY)

  const worker2Args: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: worker1Args.taskQueue + '-next',
    workflowsPath: require.resolve('./lib/workflow2'),
  }

  const worker2 = await Worker.create(worker2Args)
  const t2 = new Trigger()
  // @ts-ignore
  const worker2Run = worker2.runUntil(t2)

  // Signal migrate to new code
  await workflowRun.signal(migrateSignalName, {
    taskQueue: worker2Args.taskQueue,
  })

  // Workflow migrated when the current run id does not equal the initial run id
  await untilTrue(async () => {
    const currentRunId = await workflowRun.describe().then((x) => x.runId)
    return currentRunId !== initialRunId
  })

  const snapshot = await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => snapshot.state === 'done'
  )
  expect(Object.values(snapshot.timers).length).toEqual(0)

  t1.resolve()
  t2.resolve()
  await Promise.all([worker1Run, worker2Run])
  await testEnv!.teardown()
})

/**
 * This test ensures that workflows can be migrated with 0 changes to the workflow code
 * All workflow state should be preserved and consistent across both runs.
 */
test('workflow migrate identity', async () => {
  const testEnv = await TestWorkflowEnvironment.createTimeSkipping()

  let initialRunId: string

  const worker1Args: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: 'initial',
    workflowsPath: require.resolve('./lib/workflow1-entry'),
  }

  const worker1 = await Worker.create(worker1Args)
  const workflowRun = await testEnv.client.workflow.signalWithStart(
    'theWorkflow',
    {
      taskQueue: worker1Args.taskQueue,
      workflowId: '42',
      signal: 'hey',
      signalArgs: [''],
      followRuns: true,
    }
  )
  initialRunId = workflowRun.signaledRunId
  const t1 = new Trigger()
  // @ts-expect-error
  const worker1Run = worker1.runUntil(t1)

  const firstRunState = await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => snapshot.state === 'heyed'
  )

  const timers = Object.values(firstRunState.timers)
  expect(timers.length).toEqual(1)
  expect(timers[0].delay).toEqual(workflow1info.TIMER_DELAY)

  const timeLeft = getTimeLeft(timers[0], await testEnv.currentTimeMs())

  expect(timeLeft).toBeGreaterThan(0)
  expect(timeLeft).toBeLessThan(workflow1info.TIMER_DELAY)

  const worker2Args: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: worker1Args.taskQueue + '-next',
    workflowsPath: require.resolve('./lib/workflow1-entry'),
  }

  const worker2 = await Worker.create(worker2Args)
  const t2 = new Trigger()
  // @ts-expect-error
  const worker2Run = worker2.runUntil(t2)

  // Signal migrate to new code
  await workflowRun.signal(migrateSignalName, {
    taskQueue: worker2Args.taskQueue,
  })

  // Workflow migrated when the current run id does not equal the initial run id
  await untilTrue(async () => {
    const currentRunId = await workflowRun.describe().then((x) => x.runId)
    return currentRunId !== initialRunId
  })

  let migratedSnapshot: WorkflowSnapshot
  // new workflow started in previous state and
  // has the same timer as the previous workflow
  await waitForWorkflowCondition(workflowRun, (snapshot) => {
    expect(firstRunState.state).toEqual(snapshot.state)
    expect(firstRunState.context).toEqual(snapshot.context)
    expect(Object.keys(firstRunState.timers)).toEqual(
      Object.keys(snapshot.timers)
    )
    expect(Object.values(snapshot.timers).length === 1).toEqual(true)
    migratedSnapshot = snapshot
    return true
  })

  const timeLeftAfterMigrate = getTimeLeft(
    Object.values(migratedSnapshot!.timers)[0],
    await testEnv.currentTimeMs()
  )
  await testEnv.sleep(timeLeftAfterMigrate)

  const afterTimersFired = await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => {
      if (snapshot.state! !== 'done') {
        throw new Error("expected to be in 'done' state")
      }

      return true
    }
  )

  // machine done
  expect(afterTimersFired.state).toEqual('done')

  // context preserved
  expect(firstRunState.context).toEqual(afterTimersFired.context)

  // no timers (all fired)
  expect(Object.keys(afterTimersFired.timers)).toEqual(Object.keys([]))

  t1.resolve()
  t2.resolve()
  await Promise.all([worker1Run, worker2Run])
  await testEnv!.teardown()
})

/**
 * Tests that a workflow can be migrated to a new state
 * Replaces the `initial` state's target with a new one
 * The new one has a different name and does not have a timer
 *
 * // Workflow 1 has states A, B1, C
 * // State A transitions to State B1
 * // When State B activates a timer activates
 * wf1: -> A // start in A
 *      A -> B1 // A transitions to B1 unconditionally
 *      B1 := after(`time`) -> C // B has a timer 'time' that activates when B1, transitions to C when it fires
 *      C := final // C is a final state
 *
 * // Workflow 2 has states A, B2, C
 * wf2: -> A // start in A
 *      A -> B2 // A transitions to B2 unconditionally
 *      B2 := on('some-event') -> C // B2 to C when B2 and 'some-event'
 *      // B2 -> C := on('some-event') // B2 to C when B2 and 'some-event' / 'some-event' in B2
 *      // C <- B2 := on('some-event')  // C when B2 and `some-event`
 *      C := final // C is a final state
 *  // note: no timer
 *
 */
test('migration function - state transform', async () => {
  const testEnv = await TestWorkflowEnvironment.createTimeSkipping()

  let initialRunId: string

  const worker1Args: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: 'initial',
    workflowsPath: require.resolve('./lib/workflow1-entry'),
    reuseV8Context: true,
  }

  let worker1 = await Worker.create(worker1Args)
  const workflowRun = await testEnv.client.workflow.signalWithStart(
    'theWorkflow',
    {
      taskQueue: worker1Args.taskQueue,
      workflowId: '42',
      signal: 'hey',
      signalArgs: [''],
      followRuns: true,
    }
  )
  initialRunId = workflowRun.signaledRunId
  const t1 = new Trigger()
  // @ts-expect-error
  const worker1Run = worker1.runUntil(t1)

  const firstRunState = await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => snapshot.state === 'heyed'
  )

  const timers = Object.values(firstRunState.timers)
  expect(timers.length).toEqual(1)
  expect(timers[0].delay).toEqual(workflow1info.TIMER_DELAY)

  const timeLeft = getTimeLeft(timers[0], await testEnv.currentTimeMs())

  expect(timeLeft).toBeGreaterThan(0)
  expect(timeLeft).toBeLessThan(workflow1info.TIMER_DELAY)

  const workerNextArgs: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: worker1Args.taskQueue + '-next',
    workflowsPath: require.resolve('./lib/workflow3-entry'),
  }

  const workerNext = await Worker.create(workerNextArgs)
  const t2 = new Trigger()
  // @ts-expect-error
  const worker2Run = workerNext.runUntil(t2)

  // Signal migrate to new code
  await workflowRun.signal(migrateSignalName, {
    taskQueue: workerNextArgs.taskQueue,
  })

  // Workflow migrated when the current run id does not equal the initial run id
  await untilTrue(async () => {
    const currentRunId = await workflowRun.describe().then((x) => x.runId)
    return currentRunId !== initialRunId
  })

  const migratedSnapshot = await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => {
      // Starts in a different state from the previous run
      expect(firstRunState.state).not.toEqual(snapshot.state)

      // Start state is the desired start state
      // Note: State id is inconsistent with #test.completely-different-state
      // expect(snapshot.state).toEqual('#test.completely-different-state')
      expect(snapshot.state).toEqual('completely-different-state')

      // no context alterations as a function of the migration, or the resumed state
      expect(firstRunState.context).toEqual(snapshot.context)

      // no timers were set by the state we continued in
      expect(Object.keys(snapshot.timers)).toEqual([])

      return true
    }
  )

  // Time passes past the timer expiration
  await testEnv.sleep(workflow1info.TIMER_DELAY + 1_000_000)

  const currentState = await workflowRun.query<WorkflowSnapshot>(
    getSnapshotQueryName
  )
  expect(currentState.state).toEqual(migratedSnapshot.state)
  expect(currentState.context).toEqual(migratedSnapshot.context)
  expect(currentState.timers).toEqual({})

  t1.resolve()
  t2.resolve()
  await Promise.all([worker1Run, worker2Run])
  await testEnv.teardown()
})

test('migration function - change context (breaking)', async () => {
  const testEnv = await TestWorkflowEnvironment.createTimeSkipping()

  let initialRunId: string
  const worker1Args: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: 'initial',
    workflowsPath: require.resolve('./lib/workflow1-entry'),
  }

  const worker1 = await Worker.create(worker1Args)
  const workflowRun = await testEnv.client.workflow.signalWithStart(
    'theWorkflow',
    {
      taskQueue: worker1Args.taskQueue,
      workflowId: '42',
      signal: 'hey',
      signalArgs: [''],
      followRuns: true,
    }
  )
  initialRunId = workflowRun.signaledRunId
  const t1 = new Trigger()
  // @ts-expect-error
  const worker1Run = worker1.runUntil(t1)

  const firstRunState = await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => snapshot.state === 'heyed'
  )

  const timers = Object.values(firstRunState.timers)
  expect(timers.length).toEqual(1)
  expect(timers[0].delay).toEqual(workflow1info.TIMER_DELAY)

  const timeLeft = getTimeLeft(timers[0], await testEnv.currentTimeMs())

  expect(timeLeft).toBeGreaterThan(0)
  expect(timeLeft).toBeLessThan(workflow1info.TIMER_DELAY)

  const worker2Args: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: worker1Args.taskQueue + '-next',
    workflowsPath: require.resolve('./lib/breaking-context-intentional'),
  }

  const worker2 = await Worker.create(worker2Args)
  const t2 = new Trigger()
  // @ts-expect-error
  const worker2Run = worker2.runUntil(t2)

  // Signal migrate to new code
  await workflowRun.signal(migrateSignalName, {
    taskQueue: worker2Args.taskQueue,
  })

  // Workflow migrated when the current run id does not equal the initial run id
  await untilTrue(async () => {
    const currentRunId = await workflowRun.describe().then((x) => x.runId)
    return currentRunId !== initialRunId
  })

  let migratedSnapshot: WorkflowSnapshot
  // new workflow started in previous state and
  // has the same timer as the previous workflow
  await waitForWorkflowCondition(workflowRun, (snapshot) => {
    expect(firstRunState.state).toEqual(snapshot.state)
    // changed the context
    expect(snapshot.context).toEqual({ yo: 'hey' })
    expect(Object.keys(firstRunState.timers)).toEqual(
      Object.keys(snapshot.timers)
    )
    expect(Object.values(snapshot.timers).length === 1).toEqual(true)
    migratedSnapshot = snapshot
    return true
  })

  const timeLeftAfterMigrate = getTimeLeft(
    Object.values(migratedSnapshot!.timers)[0],
    await testEnv.currentTimeMs()
  )
  await testEnv.sleep(timeLeftAfterMigrate)

  const afterTimersFired = await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => {
      if (snapshot.state! !== 'done') {
        throw new Error("expected to be in 'done' state")
      }

      return true
    }
  )

  // machine done
  expect(afterTimersFired.state).toEqual('done')

  // context preserved
  expect(afterTimersFired.context).toEqual({ yo: 'hey' })

  // no timers (all fired)
  expect(Object.keys(afterTimersFired.timers)).toEqual(Object.keys([]))

  t1.resolve()
  t2.resolve()
  await Promise.all([worker1Run, worker2Run])
  await testEnv.teardown()
})

test('migration function - change context (compatible)', async () => {
  const testEnv = await TestWorkflowEnvironment.createTimeSkipping()

  let initialRunId: string
  const worker1Args: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: 'initial',
    workflowsPath: require.resolve('./lib/workflow1-entry'),
  }

  const worker1 = await Worker.create(worker1Args)
  const workflowRun = await testEnv.client.workflow.signalWithStart(
    'theWorkflow',
    {
      taskQueue: worker1Args.taskQueue,
      workflowId: '42',
      signal: 'hey',
      signalArgs: [''],
      followRuns: true,
    }
  )
  initialRunId = workflowRun.signaledRunId
  const t1 = new Trigger()
  // @ts-expect-error
  const worker1Run = worker1.runUntil(t1)

  const firstRunState = await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => snapshot.state === 'heyed'
  )

  const timers = Object.values(firstRunState.timers)
  expect(timers.length).toEqual(1)
  expect(timers[0].delay).toEqual(workflow1info.TIMER_DELAY)

  const timeLeft = getTimeLeft(timers[0], await testEnv.currentTimeMs())

  expect(timeLeft).toBeGreaterThan(0)
  expect(timeLeft).toBeLessThan(workflow1info.TIMER_DELAY)

  const worker2Args: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: worker1Args.taskQueue + '-next',
    workflowsPath: require.resolve('./lib/compatible-context-change'),
  }

  const worker2 = await Worker.create(worker2Args)
  const t2 = new Trigger()
  // @ts-expect-error
  const worker2Run = worker2.runUntil(t2)

  // Signal migrate to new code
  await workflowRun.signal(migrateSignalName, {
    taskQueue: worker2Args.taskQueue,
  })

  // Workflow migrated when the current run id does not equal the initial run id
  await untilTrue(async () => {
    const currentRunId = await workflowRun.describe().then((x) => x.runId)
    return currentRunId !== initialRunId
  })

  let migratedSnapshot: WorkflowSnapshot
  // new workflow started in previous state and
  // has the same timer as the previous workflow
  await waitForWorkflowCondition(workflowRun, (snapshot) => {
    expect(firstRunState.state).toEqual(snapshot.state)
    // changed the context
    expect(snapshot.context).toEqual({
      ...(firstRunState.context as any),
      yo: 'hey',
    })
    expect(Object.keys(firstRunState.timers)).toEqual(
      Object.keys(snapshot.timers)
    )
    expect(Object.values(snapshot.timers).length === 1).toEqual(true)
    migratedSnapshot = snapshot
    return true
  })

  const timeLeftAfterMigrate = getTimeLeft(
    Object.values(migratedSnapshot!.timers)[0],
    await testEnv.currentTimeMs()
  )
  await testEnv.sleep(timeLeftAfterMigrate)

  const afterTimersFired = await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => {
      if (snapshot.state! !== 'done') {
        throw new Error("expected to be in 'done' state")
      }

      return true
    }
  )

  // machine done
  expect(afterTimersFired.state).toEqual('done')

  // context preserved
  expect(afterTimersFired.context).toEqual({
    ...(firstRunState.context as any),
    yo: 'hey',
  })

  // no timers (all fired)
  expect(Object.keys(afterTimersFired.timers)).toEqual(Object.keys([]))

  t1.resolve()
  t2.resolve()
  await Promise.all([worker1Run, worker2Run])
  await testEnv.teardown()
})

/**
 * This handles a case where:
 * 1. We added a new delay to the state that we start in
 * 2. We did not specify the value of the new delay via the migration function
 *
 * The expectations are:
 * 1. The timer will be started upon entering the start state
 * 2. The timer's duration will be computed from the delay function provided by the current code
 *
 * Note:
 * When implemented this has the latent effect of supporting a reset signal that does not provide the timer value.
 * It DOES NOT address the case in which the reset signal should take precedence over the migration function in the event of a conflict.
 * This requires encoding the continuation caused by reset signal as different from the continuation caused by migrate signal,
 * likely via a special key in the workflow arguments.
 */
test('start a timer when a timer is defined in the start state and migration function does not provide it (as a continued value)', async () => {
  const testEnv = await TestWorkflowEnvironment.createTimeSkipping()

  let initialRunId: string

  const worker1Args: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: 'initial',
    workflowsPath: require.resolve('./lib/workflow1-entry'),
    reuseV8Context: true,
  }

  let worker1 = await Worker.create(worker1Args)
  const workflowRun = await testEnv.client.workflow.signalWithStart(
    'theWorkflow',
    {
      taskQueue: worker1Args.taskQueue,
      workflowId: '42',
      signal: 'hey',
      signalArgs: [''],
      followRuns: true,
    }
  )
  initialRunId = workflowRun.signaledRunId
  const t1 = new Trigger()
  // @ts-expect-error
  const worker1Run = worker1.runUntil(t1)

  const firstRunState = await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => snapshot.state === 'heyed'
  )

  const timers = Object.values(firstRunState.timers)
  expect(timers.length).toEqual(1)
  expect(timers[0].delay).toEqual(workflow1info.TIMER_DELAY)

  const timeLeft = getTimeLeft(timers[0], await testEnv.currentTimeMs())

  expect(timeLeft).toBeGreaterThan(0)
  expect(timeLeft).toBeLessThan(workflow1info.TIMER_DELAY)

  const workerNextArgs: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: worker1Args.taskQueue + '-next',
    workflowsPath: require.resolve('./lib/defer-to-next-state-machine-timers'),
  }

  const workerNext = await Worker.create(workerNextArgs)
  const t2 = new Trigger()
  // @ts-expect-error
  const worker2Run = workerNext.runUntil(t2)

  // Signal migrate to new code
  await workflowRun.signal(migrateSignalName, {
    taskQueue: workerNextArgs.taskQueue,
  })

  // Workflow migrated when the current run id does not equal the initial run id
  await untilTrue(async () => {
    const currentRunId = await workflowRun.describe().then((x) => x.runId)
    return currentRunId !== initialRunId
  })

  const migratedSnapshot = await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => {
      // Start in same state as previous run
      expect(firstRunState.state).toEqual(snapshot.state)

      // Should be this one, which has a timer / delay in it
      expect(snapshot.state).toEqual('heyed')

      // no context alterations as a function of the migration, or the resumed state
      expect(firstRunState.context).toEqual(snapshot.context)

      // timer in the start state was set and is running
      expect(Object.keys(snapshot.timers)).toEqual([
        'xstate.after(time)#test.heyed',
      ])

      return true
    }
  )

  // Expect the timer that was set on entry to actually work
  // Time passes past the timer expiration
  await testEnv.sleep(workflow1info.TIMER_DELAY + 1_000_000)
  const currentState = await workflowRun.query<WorkflowSnapshot>(
    getSnapshotQueryName
  )
  expect(currentState.timers).toEqual({})
  expect(currentState.state).toEqual('done')
  expect(currentState.context).toEqual(migratedSnapshot.context)
  t1.resolve()
  t2.resolve()

  await Promise.all([worker1Run, worker2Run])
  await testEnv.teardown()
})

test('wait for an ok state to migrate (no-migrate label)', async () => {
  const testEnv = await TestWorkflowEnvironment.createTimeSkipping()
  let initialRunId: string

  const worker1Args: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: 'initial',
    workflowsPath: require.resolve('./lib/no-migrate-in-initial'),
  }

  const worker1 = await Worker.create(worker1Args)
  const workflowRun = await testEnv.client.workflow.signalWithStart(
    'theWorkflow',
    {
      taskQueue: worker1Args.taskQueue,
      workflowId: '42',
      signal: 'not-a-signal',
      signalArgs: [''],
      followRuns: true,
    }
  )
  initialRunId = workflowRun.signaledRunId
  const t1 = new Trigger()
  // @ts-expect-error
  const worker1Run = worker1.runUntil(t1)

  // wait for it to arrive in the initial state
  await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => snapshot.state === 'initial'
  )

  // Signal migrate to new code
  await workflowRun.signal(migrateSignalName, {
    taskQueue: undefined, // same one
  })

  // Wait until the workflow's query to to reflect it is waiting to be in a state it can migrate from
  await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => snapshot.migrate.awaitingContinuationCondition
  )

  // now send the 'hey' signal, expected to transition the machine to a state in which it can be migrated
  await testEnv.client.workflow.signalWithStart('theWorkflow', {
    taskQueue: worker1Args.taskQueue,
    workflowId: '42',
    signal: 'hey',
    signalArgs: [''],
    followRuns: true,
  })

  // the workflow should pass through this state, which is ok to migrate from
  await waitForWorkflowCondition(
    workflowRun,
    // @ts-ignore
    (snapshot) => snapshot.state === 'heyed'
  )

  // Expect the migration happens
  await untilTrue(async () => {
    const currentRunId = await workflowRun.describe().then((x) => x.runId)
    return currentRunId !== initialRunId
  })

  // expect resume in second state
  await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => snapshot.state === 'heyed'
  )

  t1.resolve()
  await Promise.all([worker1Run])
  await testEnv!.teardown()
})

test('resume and re-enter activity', async () => {
  const testEnv = await TestWorkflowEnvironment.createTimeSkipping()
  let initialRunId: string

  let activityCallNumber = 0
  const worker1Args: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: 'initial',
    workflowsPath: require.resolve('./lib/activity-execute-on-resume'),
    activities: {
      hello: async () => {
        activityCallNumber += 1
        if (activityCallNumber > 1) {
          return 'ok'
        }
        throw new Error('woops')
      },
    },
  }

  const worker1 = await Worker.create(worker1Args)
  const workflowRun = await testEnv.client.workflow.signalWithStart(
    'theWorkflow',
    {
      taskQueue: worker1Args.taskQueue,
      workflowId: '42',
      signal: 'hey',
      signalArgs: [''],
      followRuns: true,
    }
  )
  initialRunId = workflowRun.signaledRunId
  const t1 = new Trigger()
  // @ts-expect-error
  const worker1Run = worker1.runUntil(t1)

  // wait for it to arrive in the initial state
  await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => snapshot.state === 'error'
  )

  // Signal migrate to new code
  await workflowRun.signal(migrateSignalName, {
    taskQueue: undefined, // same one
  })

  // now send the 'hey' signal, expected to transition the machine to a state in which it can be migrated
  await testEnv.client.workflow.signalWithStart('theWorkflow', {
    taskQueue: worker1Args.taskQueue,
    workflowId: '42',
    signal: 'hey',
    signalArgs: [''],
    followRuns: true,
  })

  // Expect the migration happens
  await untilTrue(async () => {
    const currentRunId = await workflowRun.describe().then((x) => x.runId)
    return currentRunId !== initialRunId
  })

  // the workflow should complete the activity successfully this time
  // and the state machine should be in the done state
  await waitForWorkflowCondition(
    workflowRun,
    // @ts-ignore
    (snapshot) => snapshot.state === 'done'
  )

  t1.resolve()
  await Promise.all([worker1Run])
  await testEnv!.teardown()
})

test('wait to migrate when state node that has activity is not tagged with "interruptible"', async () => {
  const testEnv = await TestWorkflowEnvironment.createTimeSkipping()
  let initialRunId: string

  const activityTrigger = new Trigger()
  const worker1Args: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: 'initial',
    workflowsPath: require.resolve('./lib/activity-execute-on-resume'),
    activities: {
      hello: async () => {
        await activityTrigger
        return 'ok'
      },
    },
  }

  const worker1 = await Worker.create(worker1Args)
  const workflowRun = await testEnv.client.workflow.signalWithStart(
    'theWorkflow',
    {
      taskQueue: worker1Args.taskQueue,
      workflowId: '42',
      signal: 'hey',
      signalArgs: [''],
      followRuns: true,
    }
  )
  initialRunId = workflowRun.signaledRunId
  const t1 = new Trigger()
  // @ts-expect-error
  const worker1Run = worker1.runUntil(t1)

  // wait for it to arrive in the initial state
  await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => snapshot.state === 'second'
  )

  // Signal migrate to new code
  await workflowRun.signal(migrateSignalName, {
    taskQueue: undefined, // same one
  })

  // expect the workflow to be waiting to migrate
  await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => snapshot.migrate.awaitingContinuationCondition
  )

  // The activity completes
  activityTrigger.resolve()

  // Expect the migration happens
  await untilTrue(async () => {
    const currentRunId = await workflowRun.describe().then((x) => x.runId)
    return currentRunId !== initialRunId
  })
  // expect the workflow to have resumed in the next state
  await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => snapshot.state === 'done'
  )

  t1.resolve()
  await Promise.all([worker1Run])
  await testEnv!.teardown()
})

test('migrate when in a state tagged interruptible and an activity', async () => {
  const testEnv = await TestWorkflowEnvironment.createTimeSkipping()
  let initialRunId: string

  let numberOfActivityCalls = 0
  let numberOfActivityCompletions = 0
  const activityTrigger = new Trigger()
  const worker1Args: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: 'initial',
    workflowsPath: require.resolve(
      './lib/activity-migrate-when-executing-and-interruptible'
    ),
    activities: {
      hello: async () => {
        console.log('activity called')
        numberOfActivityCalls += 1
        console.log('activity executing...')
        await activityTrigger
        console.log('activity done executing')
        numberOfActivityCompletions += 1
        console.log('activity returning')
        return 'ok'
      },
    },
  }

  const worker1 = await Worker.create(worker1Args)
  const workflowRun = await testEnv.client.workflow.signalWithStart(
    'theWorkflow',
    {
      taskQueue: worker1Args.taskQueue,
      workflowId: '42',
      signal: 'hey',
      signalArgs: [''],
      followRuns: true,
    }
  )
  initialRunId = workflowRun.signaledRunId
  const t1 = new Trigger()
  // @ts-expect-error
  const worker1Run = worker1.runUntil(t1)

  // wait for it to arrive in the state with the activity
  await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => snapshot.state === 'second'
  )

  // Signal migrate to new code
  await workflowRun.signal(migrateSignalName, {
    taskQueue: undefined, // same one
  })

  // The activity is cancelled
  // activityTrigger.resolve()

  // Expect the migration happens
  await untilTrue(async () => {
    const currentRunId = await workflowRun.describe().then((x) => x.runId)
    return currentRunId !== initialRunId
  })

  // expect the workflow to have resumed in the next state
  // and for the activity to be called again
  await waitForWorkflowCondition(
    workflowRun,
    (snapshot) => snapshot.state === 'second' && numberOfActivityCalls === 2
  )
  activityTrigger.resolve()

  t1.resolve()
  await Promise.all([worker1Run])
  await testEnv!.teardown()
})

test('xstate does not start timers when we start the state machine in a state that has them', async () => {
  const ident = '#test.heyed'

  const state = machine.resolveStateValue(ident, {})!

  const interpreter = new CustomInterpreter(
    machine,
    // @ts-ignore
    { state: state! }
  )

  interpreter.start()
  // @ts-ignore
  const startState: AnyState = await waitFor(
    interpreter,
    (x) => x.value === 'heyed'
  )

  // Establish that XState does not start timers for us:

  // 1. We started in this state
  expect(startState.value).toEqual('heyed')
  // 2. We don't have any timer data that we use for persistence
  expect(Object.values(interpreter.getTimers()).length).toEqual(0)
  // 3. XState says it has no timers
  expect(interpreter.getXStateInternalDelayedEventsMap()).toEqual({})
  // 4. Our clock has no timers
  expect(interpreter.clock.getAllTimers()).toEqual({})
  // 5. But the start state has a delay defined in it
  expect(startState.nextEvents.some((x) => isXStateAfterId(x))).toEqual(true)

  interpreter.stop()
})

test.concurrent('getDelayFunctionName', () => {
  fc.assert(
    fc.property(getArbitrary(XStateTimerId), (id) => {
      expect(id.startsWith('xstate.after(')).toEqual(true)
      const fn = id.slice('xstate.after('.length, id.lastIndexOf('#') - 1)
      console.log({ id, fn })
    })
  )
})

test('signals drained', async () => {
  const testEnv = await TestWorkflowEnvironment.createTimeSkipping()
  let initialRunId: string

  const worker1Args: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: 'initial',
    workflowsPath: require.resolve('./lib/signals-drain-before'),
    sinks: { ...loggerSink },
  }

  const args = R.range(0, 10).map((n) => ({
    taskQueue: worker1Args.taskQueue,
    workflowId: '42',
    signal: 'hey',
    signalArgs: [{ type: 'hey', payload: n }],
    followRuns: true,
  }))

  let workflowRun: WorkflowHandleWithSignaledRunId
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  // send 5 events so they stack up
  for (const arg of args.slice(0, 5)) {
    await sleep(1000)
    console.log('sending', arg.signalArgs[0].payload)
    workflowRun = await testEnv.client.workflow.signalWithStart(
      'theWorkflow',
      arg
    )
    // @ts-expect-error wut
    if (initialRunId && initialRunId !== workflowRun.signaledRunId) {
      throw new Error('expected the run id to be the same')
    }
    initialRunId = workflowRun.signaledRunId
  }
  // then queue the migration event
  // @ts-expect-error wut
  await workflowRun.signal(migrateSignalName, {
    taskQueue: 'second-worker',
  })

  // followed immediately by the remaining 5 events
  for (const arg of args.slice(5)) {
    await sleep(1000)
    console.log('sending', arg.signalArgs[0].payload)
    workflowRun = await testEnv.client.workflow.signalWithStart(
      'theWorkflow',
      arg
    )
    // @ts-expect-error wut
    if (initialRunId && initialRunId !== workflowRun.signaledRunId) {
      throw new Error('expected the run id to be the same')
    }
    initialRunId = workflowRun.signaledRunId
  }

  const worker1 = await Worker.create(worker1Args)
  const worker2 = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: 'second-worker',
    workflowsPath: require.resolve('./lib/signals-drain-before'),
    sinks: { ...loggerSink },
  })

  const t1 = new Trigger()
  const t2 = new Trigger()
  // @ts-expect-error
  const worker1Run = worker1.runUntil(t1)
  await sleep(5000)
  // @ts-expect-error
  const worker2Run = worker2.runUntil(t2)

  // Expect the migration happens
  await untilTrue(async () => {
    const currentRunId = await workflowRun.describe().then((x) => x.runId)
    return currentRunId !== initialRunId
  })

  // expect the workflow to have resumed in the next state
  // and for the activity to be called again
  await waitForWorkflowCondition(
    // @ts-expect-error
    workflowRun,
    (snapshot) => {
      // @ts-expect-error
      return snapshot?.context.events?.length === 10
    }
  )

  t1.resolve()
  t2.resolve()
  await Promise.all([worker1Run, worker2Run])
  await testEnv!.teardown()
})

test('signals drained when signal storm', async () => {
  const testEnv = await TestWorkflowEnvironment.createTimeSkipping()
  let initialRunId: string

  const worker1Args: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: 'initial',
    workflowsPath: require.resolve('./lib/signals-drain-before'),
    sinks: { ...loggerSink },
  }

  const args = R.range(0, 10).map((n) => ({
    taskQueue: worker1Args.taskQueue,
    workflowId: '42',
    signal: 'hey',
    signalArgs: [{ type: 'hey', payload: n }],
    followRuns: true,
  }))

  let workflowRun: WorkflowHandleWithSignaledRunId
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  // send 5 events so they stack up
  for (const arg of args.slice(0, 5)) {
    console.log('sending', arg.signalArgs[0].payload)
    workflowRun = await testEnv.client.workflow.signalWithStart(
      'theWorkflow',
      arg
    )
    // @ts-expect-error wut
    if (initialRunId && initialRunId !== workflowRun.signaledRunId) {
      throw new Error('expected the run id to be the same')
    }
    initialRunId = workflowRun.signaledRunId
  }
  // then queue the migration event
  // @ts-expect-error wut
  await workflowRun.signal(migrateSignalName, {
    taskQueue: 'second-worker',
  })

  // followed immediately by the remaining 5 events
  for (const arg of args.slice(5)) {
    console.log('sending', arg.signalArgs[0].payload)
    workflowRun = await testEnv.client.workflow.signalWithStart(
      'theWorkflow',
      arg
    )
    // @ts-expect-error wut
    if (initialRunId && initialRunId !== workflowRun.signaledRunId) {
      throw new Error('expected the run id to be the same')
    }
    initialRunId = workflowRun.signaledRunId
  }

  const worker1 = await Worker.create(worker1Args)
  const worker2 = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: 'second-worker',
    workflowsPath: require.resolve('./lib/signals-drain-before'),
    sinks: { ...loggerSink },
  })

  const sendSignals = (ms: number, maxIter: number) => {
    let timeout: any
    let cancel = new Trigger()
    let i = args.length
    let canceled = false

    return {
      getNumberSent: () => i,
      start: async () => {
        const f = (i: number) =>
          new Promise((resolve) => {
            timeout = setTimeout(async () => {
              console.log('sending', i)
              workflowRun = await testEnv.client.workflow.signalWithStart(
                'theWorkflow',
                {
                  taskQueue: worker1Args.taskQueue,
                  workflowId: '42',
                  signal: 'hey',
                  signalArgs: [{ type: 'hey', payload: i }],
                  followRuns: true,
                }
              )
              resolve(undefined)
            }, ms)
          })

        for (; i < maxIter; i++) {
          if (canceled) return
          await Promise.race([f(i), cancel])
        }
      },
      stop: () => {
        canceled = true
        clearTimeout(timeout)
        cancel.resolve()
      },
    }
  }

  const t1 = new Trigger()
  const t2 = new Trigger()
  const signaler = sendSignals(100, 200)
  // @ts-expect-error
  const worker1Run = worker1.runUntil(() => {
    signaler.start()
    return t1
  })
  await sleep(5000)
  // @ts-expect-error
  const worker2Run = worker2.runUntil(t2)

  // Expect the migration happens
  await untilTrue(async () => {
    const currentRunId = await workflowRun.describe().then((x) => x.runId)
    return currentRunId !== initialRunId
  })
  // console.log('migration happened before now')

  // expect the workflow to have resumed in the next state
  // and for the activity to be called again
  await waitForWorkflowCondition(
    // @ts-expect-error
    workflowRun,
    (snapshot) => {
      return (
        // @ts-expect-error
        snapshot?.context.events?.length === signaler.getNumberSent()
      )
    }
  )

  signaler.stop()
  t1.resolve()
  t2.resolve()
  await Promise.all([worker1Run, worker2Run])
  await testEnv!.teardown()
})
