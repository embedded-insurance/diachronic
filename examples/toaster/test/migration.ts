import {
  DefaultLogger,
  Runtime,
  Worker,
  WorkerOptions,
} from '@temporalio/worker'
import { TestWorkflowEnvironment } from '@temporalio/testing'
import { Trigger } from '@diachronic/util/trigger'
import { getTimeLeft } from '@diachronic/migrate/interpreter'
import { migrateSignalName } from '@diachronic/migrate/can-migrate'
import {
  awaitMigrated,
  waitForWorkflowCondition,
} from '@diachronic/migrate/test'

jest.setTimeout(200_000)

beforeAll(async () => {
  Runtime.install({
    logger: new DefaultLogger('WARN'),
  })
})
test('toaster migration', async () => {
  const testEnv = await TestWorkflowEnvironment.createTimeSkipping()
  let prevRunId: string

  const prevWorkflowConfig: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: 'initial',
    workflowsPath: require.resolve('./../src/index'),
  }

  const prevWorker = await Worker.create(prevWorkflowConfig)
  const prevWorkflowRun = await testEnv.client.workflow.signalWithStart(
    'toaster',
    {
      taskQueue: prevWorkflowConfig.taskQueue,
      workflowId: '42',
      signal: 'plug-it-in',
      signalArgs: [undefined],
      followRuns: true,
    }
  )
  prevRunId = prevWorkflowRun.signaledRunId
  const prevWorkerTrigger = new Trigger()
  // @ts-expect-error
  const prevWorkerRun = prevWorker.runUntil(prevWorkerTrigger)

  await waitForWorkflowCondition(
    prevWorkflowRun,
    (snapshot) => snapshot.state === 'OFF'
  )
  const timerDuration = 5000
  await prevWorkflowRun.signal('set-toast-time', {
    duration: timerDuration,
  })
  const state = await waitForWorkflowCondition(
    prevWorkflowRun,
    (snapshot) => snapshot.state === 'ON'
  )

  const timers = Object.values(state.timers)
  expect(timers.length).toEqual(1)
  expect(timers[0].delay).toEqual(timerDuration)

  const timeLeft = getTimeLeft(timers[0], await testEnv.currentTimeMs())

  expect(timeLeft).toBeGreaterThan(0)
  expect(timeLeft).toBeLessThan(timerDuration)

  const nextWorkflowWorkerConfig: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: prevWorkflowConfig.taskQueue + '-next',
    workflowsPath: require.resolve('./../src/v2'),
  }

  const nextWorker = await Worker.create(nextWorkflowWorkerConfig)
  const nextWorkerTrigger = new Trigger()
  // @ts-ignore
  const nextWorkerRun = nextWorker.runUntil(nextWorkerTrigger)

  // Migrate to new code
  await prevWorkflowRun.signal(migrateSignalName, {
    taskQueue: nextWorkflowWorkerConfig.taskQueue,
  })

  await awaitMigrated(prevRunId, prevWorkflowRun)

  const snapshot = await waitForWorkflowCondition(
    prevWorkflowRun,
    (snapshot) => {
      return (
        snapshot.state === 'ON' &&
        Object.keys(snapshot.timers || {}).length === 1 &&
        // @ts-ignore
        snapshot.context.powered
      )
    }
  )

  expect(Object.values(snapshot.timers).length).toEqual(1)

  prevWorkerTrigger.resolve()
  nextWorkerTrigger.resolve()
  await Promise.all([prevWorkerRun, nextWorkerRun])
  await testEnv!.teardown()
})
