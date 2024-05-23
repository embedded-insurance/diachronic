import {
  DefaultLogger,
  Runtime,
  Worker,
  WorkerOptions,
} from '@temporalio/worker'
import { DeterminismViolationError } from '@temporalio/workflow'
import { TestWorkflowEnvironment } from '@temporalio/testing'
import { Trigger } from '@diachronic/util/trigger'
import { getTimeLeft } from '@diachronic/migrate/interpreter'
import { waitForWorkflowCondition } from '@diachronic/migrate/test'

jest.setTimeout(120_000)
beforeAll(async () => {
  Runtime.install({
    logger: new DefaultLogger('WARN'),
  })
})
test('toaster nondeterminism', async () => {
  const testEnv = await TestWorkflowEnvironment.createLocal()
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
      retry: {
        maximumAttempts: 1,
      },
    }
  )
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

  prevWorkerTrigger.resolve()

  // roll out new code
  const nextWorkflowWorkerConfig: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: prevWorkflowConfig.taskQueue,
    workflowsPath: require.resolve('./../src/v2'),
  }
  const history = await prevWorkflowRun.fetchHistory()
  try {
    await Worker.runReplayHistory(nextWorkflowWorkerConfig, history)
      .then(() => {
        throw new Error('Expected Worker.runReplayHistory to throw')
      })
      .catch((err) => {
        expect(err instanceof DeterminismViolationError).toEqual(true)
      })
  } finally {
    await Promise.all([prevWorkerRun])
    await testEnv!.teardown()
  }
})
