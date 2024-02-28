import { TestWorkflowEnvironment } from '@temporalio/testing'
import {
  Runtime,
  Worker,
  WorkerOptions,
  DefaultLogger,
} from '@temporalio/worker'
import { Trigger } from '@diachronic/util/trigger'
import { loggerSink } from '@diachronic/workflow/workflow-logging'
import { Effect } from 'effect'
import { workflowTaskQueueName } from '@diachronic/toolbox/infra/versioning'
import { workflowVersionFlagName } from '@diachronic/toolbox/infra/feature-flag-config'
import {
  activityDefinitions,
  workflowDefinitions,
} from '../src/activities/definitions'
import { CallableGroup } from '@diachronic/activity/effect'
import * as RT from 'effect/Runtime'
import { makeActivities } from '@diachronic/activity/activity'
import { UnsupportedSimulation } from '../src/activities/simulation/types'

// jest.setTimeout(200_000)

type CIWorkflowActivities = CallableGroup<
  (typeof workflowDefinitions.workflowCI)['temporal.workflow']['activities']
>

// This can be used to verify the output but there's no easy way to test it rn
test.skip('does not mangle errors', async () => {
  Runtime.install({
    logger: new DefaultLogger('WARN'),
  })
  const testEnv = await TestWorkflowEnvironment.createTimeSkipping()

  const fakes: CIWorkflowActivities = {
    getAllWorkflowVersionFlags: (args) =>
      Effect.succeed([
        {
          workflowName: args.workflowName,
          seqId: '001',
          versionId: 'def',
          environment: 'development',
          taskQueue: workflowTaskQueueName({
            workflowName: args.workflowName,
            versionId: 'def',
          }),
          flagName: workflowVersionFlagName(args.workflowName, 'def', '001'),
        },
        {
          workflowName: args.workflowName,
          seqId: '000',
          versionId: 'abc',
          environment: 'development',
          taskQueue: workflowTaskQueueName({
            workflowName: args.workflowName,
            versionId: 'abc',
          }),
          flagName: workflowVersionFlagName(args.workflowName, 'abc', '000'),
        },
      ]),
    applyWorkflowVersionFlag: (args) =>
      Effect.succeed({
        seqId: '002',
        workflowName: args.workflowName,
        versionId: args.versionId,
        environment: args.environment,
        taskQueue: workflowTaskQueueName({
          workflowName: args.workflowName,
          versionId: args.versionId,
        }),
        flagName: workflowVersionFlagName(
          args.workflowName,
          args.versionId,
          '002'
        ),
      }),
    startWorkflowSimulation: (args) =>
      Effect.fail(
        new UnsupportedSimulation({
          message: 'Unsupported simulation',
          environment: args.environment,
          scenarioName: args.scenarioName,
        })
      ),
    applyWorkflowTrafficRouting: (args) =>
      Effect.succeed({ flagName: args.workflowFlagName }),
  }
  const worker1Args: WorkerOptions = {
    connection: testEnv.nativeConnection,
    taskQueue: 'initial',
    workflowsPath: require.resolve('./../src/workflow'),
    bundlerOptions: {
      ignoreModules: ['@temporalio/client', 'child_process', 'fs'],
    },
    sinks: { ...loggerSink },
    activities: makeActivities(
      activityDefinitions,
      // @ts-expect-error
      fakes,
      RT.defaultRuntime
    ),
  }

  const worker1 = await Worker.create(worker1Args)
  const workflowRun = await testEnv.client.workflow.signalWithStart(
    'workflowCI',
    {
      taskQueue: worker1Args.taskQueue,
      workflowId: '42',
      signal: 'diachronic.ci.workflow.deploy.success',
      signalArgs: [
        {
          workflowName: 'wfname',
          versionId: 'vid',
          sha: 'shaa',
          environment: 'production',
          eventTime: '123',
        },
      ],
      followRuns: true,
    }
  )
  const t1 = new Trigger()
  // @ts-expect-error
  const worker1Run = worker1.runUntil(t1)

  // t1.resolve()
  await Promise.all([worker1Run])
  await testEnv!.teardown()
})
