import * as R from 'ramda'
import { Effect, Exit, Layer, pipe, Ref, Runtime } from 'effect'
import { workflowVersionFlagName } from '@diachronic/toolbox/infra/feature-flag-config'
import { workflowTaskQueueName } from '@diachronic/toolbox/infra/versioning'
import { CallableGroup } from '@diachronic/activity/effect'
import { EffectWorkflowAPIs } from '@diachronic/workflow/child'
import { Trigger } from '@diachronic/util/trigger'
import { TemporalLogLayer } from '@diachronic/workflow/workflow-logging'
import { Ctx, registerSignalHandlers, Signaling } from '../src/workflow-ci'
import { DbFx } from '../src/lib/dbfx'
import { workflowDefinitions } from '../src/activities/definitions'
import { UnsupportedSimulation } from '../src/activities/simulation/types'

type CIWorkflowActivities = CallableGroup<
  (typeof workflowDefinitions.workflowCI)['temporal.workflow']['activities']
>
type CIWorkflowWorkflows = EffectWorkflowAPIs<
  (typeof workflowDefinitions.workflowCI)['temporal.workflow']['childWorkflows']
>

test('workflow run completed with success', async () => {
  const fakes: CIWorkflowActivities & CIWorkflowWorkflows = {
    // Activities
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
      Effect.succeed({
        environment: args.environment,
        workflowName: args.workflowName,
        versionId: args.versionId,
        scenarioName: args.scenarioName,
        successes: [],
        failures: [],
        timeStarted: '123',
      }),
    // Workflows
    migration: {
      startChild: (args) =>
        Effect.succeed({
          cancel: () => Effect.succeed(Effect.void),
          signal: () => Effect.succeed('OK'),
          result: () =>
            pipe(
              Effect.sleep(500),
              Effect.flatMap(() =>
                Effect.succeed(Exit.succeed({ x: 'exit from  migration' }))
              )
            ),
          workflowId: 'workflowId',
          firstExecutionRunId: 'firstExecutionRunId',
        }),
      executeChild: (args) => Effect.succeed('OK'),
    },
    rollout: {
      executeChild: (args) => Effect.succeed('OK'),
      startChild: (args) =>
        Effect.succeed({
          cancel: () => Effect.succeed(Effect.void),
          signal: () => Effect.succeed('OK'),
          result: () =>
            pipe(
              Effect.sleep(1500),
              Effect.flatMap(() =>
                Effect.succeed(Exit.succeed({ x: 'exit from rollout' }))
              )
            ),
          workflowId: 'workflowId',
          firstExecutionRunId: 'firstExecutionRunId',
        }),
    },
    cleanup: {
      executeChild: (args) => Effect.succeed('OK'),
      startChild: (args) =>
        Effect.succeed({
          cancel: () => Effect.succeed(Effect.void),
          signal: () => Effect.succeed('OK'),
          result: () =>
            pipe(
              Effect.sleep(1500),
              Effect.flatMap(() =>
                Effect.succeed(Exit.succeed({ x: 'exit from rollout' }))
              )
            ),
          workflowId: 'workflowId',
          firstExecutionRunId: 'firstExecutionRunId',
        }),
    },
    applyWorkflowTrafficRouting: (args) =>
      Effect.succeed({ flagName: args.workflowFlagName }),
  }
  const db = Ref.unsafeMake({} as any)
  const dbFx = DbFx(db)
  const ctx = {
    db: dbFx,
    fx: fakes,
    self: {
      signalWorkflow: () => Effect.fail('not implemented'),
      isContinueAsNewSuggested: () => Effect.succeed(false),
      continueAsNew: () => {
        throw new Error('continue as new')
      },
      close: jest.fn((args) =>
        Effect.sync(() => {
          if (Exit.isExit(args) && Exit.isSuccess(args)) {
            expect(
              // @ts-ignore
              args.value.x === 'exit from rollout' ||
                // @ts-ignore
                args.value.x === 'exit from  migration'
            ).toEqual(true)
          } else {
            expect(true).toEqual(false)
          }
        })
      ),
    },
  }
  const runtime = pipe(
    Layer.succeed(Ctx, ctx),
    Layer.provideMerge(TemporalLogLayer('Trace')),
    Layer.toRuntime,
    Effect.scoped,
    Effect.runSync
  )
  const { signaling } = registerSignalHandlers(runtime)
  const migrationDone = jest.fn((args) => {
    console.log('it was called with', args)
    expect(Exit.isExit(args)).toEqual(true)
    return Effect.void;
  })

  signaling.handle('migration.done', migrationDone)

  const result = pipe(
    signaling.route({
      // @ts-ignore
      type: 'diachronic.ci.workflow.deploy.success',
      payload: {
        workflowName: 'wfname',
        versionId: 'vid',
        sha: 'shaa',
        environment: 'development',
        eventTime: '123',
        isDarkDeploy: false,
        isNonMigratory: false,
      },
    }),
    Effect.provide(Layer.succeed(Signaling, signaling)),
    Runtime.runPromiseExit(runtime)
  )
  const second = await pipe(
    signaling.route({
      // @ts-ignore
      type: 'foo',
      payload: {
        workflowName: 'wfname',
        versionId: 'vid',
        sha: 'shaa',
        environment: 'development',
        eventTime: '123',
      },
    }),
    Effect.provide(Layer.succeed(Signaling, signaling)),
    Runtime.runPromiseExit(runtime)
  )
  expect(Exit.isFailure(second)).toEqual(true)

  await Effect.runPromise(Effect.sleep(3000))
  const context = pipe(dbFx.deref(), Effect.runSync)
  expect(ctx.self.close).toHaveBeenCalledTimes(1)
  expect(Object.keys(context.workflows).sort()).toEqual([
    'migration',
    'rollout',
  ])
  expect(R.dissoc('workflows', context)).toEqual({
    config: {
      environment: 'development',
      eventTime: '123',
      isDarkDeploy: false,
      isNonMigratory: false,
      sha: 'shaa',
      versionId: 'vid',
      workflowName: 'wfname',
    },
    fromVersion: {
      environment: 'development',
      flagName: 'workflow.wfname.seqId.001.version.def',
      seqId: '001',
      taskQueue: 'wfname-def',
      versionId: 'def',
      workflowName: 'wfname',
    },
    allWorkflowFlags: [
      {
        environment: 'development',
        flagName: 'workflow.wfname.seqId.001.version.def',
        seqId: '001',
        taskQueue: 'wfname-def',
        versionId: 'def',
        workflowName: 'wfname',
      },
      {
        environment: 'development',
        flagName: 'workflow.wfname.seqId.000.version.abc',
        seqId: '000',
        taskQueue: 'wfname-abc',
        versionId: 'abc',
        workflowName: 'wfname',
      },
    ],
    previousVersion: {
      simulations: {
        default: {
          environment: 'development',
          failures: [],
          scenarioName: 'default',
          successes: [],
          timeStarted: '123',
          versionId: 'def',
          workflowName: 'wfname',
        },
      },
    },
    simulations: {
      default: {
        environment: 'development',
        failures: [],
        scenarioName: 'default',
        successes: [],
        timeStarted: '123',
        versionId: 'vid',
        workflowName: 'wfname',
      },
    },
    toVersion: {
      flagName: 'workflow.wfname.seqId.002.version.vid',
      seqId: '002',
      taskQueue: 'wfname-vid',
      versionId: 'vid',
      workflowName: 'wfname',
    },
  })
})

test('production deployment + unsupported simulation', async () => {
  const fakes: CIWorkflowActivities & CIWorkflowWorkflows = {
    // Activities
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
    // Workflows
    migration: {
      startChild: (args) =>
        Effect.succeed({
          cancel: () => Effect.succeed(Effect.void),
          signal: () => Effect.succeed('OK'),
          result: () =>
            pipe(
              Effect.sleep(500),
              Effect.flatMap(() =>
                Effect.succeed(Exit.succeed({ x: 'exit from  migration' }))
              )
            ),
          workflowId: 'workflowId',
          firstExecutionRunId: 'firstExecutionRunId',
        }),
      executeChild: (args) => Effect.succeed('OK'),
    },
    rollout: {
      executeChild: (args) => Effect.succeed('OK'),
      startChild: (args) =>
        Effect.succeed({
          cancel: () => Effect.succeed(Effect.void),
          signal: () => Effect.succeed('OK'),
          result: () =>
            pipe(
              Effect.sleep(1500),
              Effect.flatMap(() =>
                Effect.succeed(Exit.succeed({ x: 'exit from rollout' }))
              )
            ),
          workflowId: 'workflowId',
          firstExecutionRunId: 'firstExecutionRunId',
        }),
    },
    cleanup: {
      executeChild: (args) => Effect.succeed('OK'),
      startChild: (args) =>
        Effect.succeed({
          cancel: () => Effect.succeed(Effect.void),
          signal: () => Effect.succeed('OK'),
          result: () =>
            pipe(
              Effect.sleep(1500),
              Effect.flatMap(() =>
                Effect.succeed(Exit.succeed({ x: 'exit from rollout' }))
              )
            ),
          workflowId: 'workflowId',
          firstExecutionRunId: 'firstExecutionRunId',
        }),
    },
    applyWorkflowTrafficRouting: (args) =>
      Effect.succeed({ flagName: args.workflowFlagName }),
  }
  const db = Ref.unsafeMake({} as any)
  const dbFx = DbFx(db)
  const ctx = {
    db: dbFx,
    fx: fakes,
    self: {
      signalWorkflow: () => Effect.fail('not implemented'),
      isContinueAsNewSuggested: () => Effect.succeed(false),
      continueAsNew: () => {
        throw new Error('continue as new')
      },
      close: jest.fn((args) =>
        Effect.sync(() => {
          if (Exit.isExit(args) && Exit.isSuccess(args)) {
            expect(
              // @ts-ignore
              args.value.x === 'exit from rollout' ||
                // @ts-ignore
                args.value.x === 'exit from  migration'
            ).toEqual(true)
          } else {
            expect(true).toEqual(false)
          }
        })
      ),
    },
  }
  const runtime = pipe(
    Layer.succeed(Ctx, ctx),
    Layer.provideMerge(TemporalLogLayer('Trace')),
    Layer.toRuntime,
    Effect.scoped,
    Effect.runSync
  )
  const { signaling } = registerSignalHandlers(runtime)
  const migrationDone = jest.fn((args) => {
    console.log('it was called with', args)
    expect(Exit.isExit(args)).toEqual(true)
    return Effect.void;
  })

  signaling.handle('migration.done', migrationDone)

  const result = pipe(
    signaling.route({
      // @ts-ignore
      type: 'diachronic.ci.workflow.deploy.success',
      payload: {
        workflowName: 'wfname',
        versionId: 'vid',
        sha: 'shaa',
        // these are not consistent in test data
        // they are currently only used to start simulations or not
        environment: 'production',
        eventTime: '123',
        isNonMigratory: false,
        isDarkDeploy: false,
      },
    }),
    Effect.provide(Layer.succeed(Signaling, signaling)),
    Runtime.runPromiseExit(runtime)
  )
  const second = await pipe(
    signaling.route({
      // @ts-ignore
      type: 'foo',
      payload: {
        workflowName: 'wfname',
        versionId: 'vid',
        sha: 'shaa',
        environment: 'production',
        eventTime: '123',
      },
    }),
    Effect.provide(Layer.succeed(Signaling, signaling)),
    Runtime.runPromiseExit(runtime)
  )
  expect(Exit.isFailure(second)).toEqual(true)

  await Effect.runPromise(Effect.sleep(3000))
  const context = pipe(dbFx.deref(), Effect.runSync)
  expect(ctx.self.close).toHaveBeenCalledTimes(1)
  expect(Object.keys(context.workflows).sort()).toEqual([
    'migration',
    'rollout',
  ])
  expect(
    R.omit(['workflows', 'previousVersion', 'simulations'], context)
  ).toEqual({
    config: {
      environment: 'production',
      eventTime: '123',
      isDarkDeploy: false,
      isNonMigratory: false,
      sha: 'shaa',
      versionId: 'vid',
      workflowName: 'wfname',
    },
    fromVersion: {
      environment: 'development',
      flagName: 'workflow.wfname.seqId.001.version.def',
      seqId: '001',
      taskQueue: 'wfname-def',
      versionId: 'def',
      workflowName: 'wfname',
    },
    allWorkflowFlags: [
      {
        environment: 'development',
        flagName: 'workflow.wfname.seqId.001.version.def',
        seqId: '001',
        taskQueue: 'wfname-def',
        versionId: 'def',
        workflowName: 'wfname',
      },
      {
        environment: 'development',
        flagName: 'workflow.wfname.seqId.000.version.abc',
        seqId: '000',
        taskQueue: 'wfname-abc',
        versionId: 'abc',
        workflowName: 'wfname',
      },
    ],
    toVersion: {
      flagName: 'workflow.wfname.seqId.002.version.vid',
      seqId: '002',
      taskQueue: 'wfname-vid',
      versionId: 'vid',
      workflowName: 'wfname',
    },
  })
})

test('dark deploy + migration', async () => {
  const ciDone = new Trigger()

  const fakes: CIWorkflowActivities & CIWorkflowWorkflows = {
    // Activities
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

    // Workflows
    migration: {
      startChild: (args) =>
        Effect.succeed({
          cancel: () => Effect.succeed(Effect.void),
          signal: () => Effect.succeed('OK'),
          result: () =>
            pipe(
              Effect.sleep(500),
              Effect.flatMap(() =>
                Effect.succeed(Exit.succeed({ x: 'exit from  migration' }))
              )
            ),
          workflowId: 'workflowId',
          firstExecutionRunId: 'firstExecutionRunId',
        }),
      executeChild: (args) => Effect.succeed('OK'),
    },
    rollout: {
      executeChild: (args) => Effect.succeed('OK'),
      startChild: (args) =>
        Effect.succeed({
          cancel: () => Effect.succeed(Effect.void),
          signal: () => Effect.succeed('OK'),
          result: () =>
            pipe(
              Effect.sleep(1500),
              Effect.flatMap(() =>
                Effect.succeed(Exit.succeed({ x: 'exit from rollout' }))
              )
            ),
          workflowId: 'workflowId',
          firstExecutionRunId: 'firstExecutionRunId',
        }),
    },
    cleanup: {
      executeChild: (args) => Effect.succeed('OK'),
      startChild: (args) =>
        Effect.succeed({
          cancel: () => Effect.succeed(Effect.void),
          signal: () => Effect.succeed('OK'),
          result: () =>
            pipe(
              Effect.sleep(1500),
              Effect.flatMap(() =>
                Effect.succeed(Exit.succeed({ x: 'exit from rollout' }))
              )
            ),
          workflowId: 'workflowId',
          firstExecutionRunId: 'firstExecutionRunId',
        }),
    },
  }

  const db = Ref.unsafeMake({} as any)
  const dbFx = DbFx(db)
  const ctx = {
    db: dbFx,
    fx: fakes,
    self: {
      signalWorkflow: () => Effect.fail('not implemented'),
      isContinueAsNewSuggested: () => Effect.succeed(false),
      continueAsNew: () => {
        throw new Error('continue as new')
      },
      close: jest.fn((args) =>
        Effect.sync(() => {
          if (Exit.isExit(args) && Exit.isSuccess(args)) {
            expect(
              // @ts-ignore
              args.value.x === 'exit from rollout' ||
                // @ts-ignore
                args.value.x === 'exit from  migration'
            ).toEqual(true)
          } else {
            expect(true).toEqual(false)
          }
          ciDone.resolve(undefined)
        })
      ),
    },
  }

  const runtime = pipe(
    Layer.succeed(Ctx, ctx),
    Layer.provideMerge(TemporalLogLayer('Trace')),
    Layer.toRuntime,
    Effect.scoped,
    Effect.runSync
  )
  const { signaling } = registerSignalHandlers(runtime)

  const migrationDoneHandler = jest.fn((args) => {
    expect(Exit.isExit(args)).toEqual(true)
    return Effect.void;
  })

  signaling.handle('migration.done', migrationDoneHandler)

  await pipe(
    signaling.route({
      // @ts-ignore
      type: 'diachronic.ci.workflow.deploy.success',
      payload: {
        workflowName: 'wfname',
        versionId: 'vid',
        sha: 'shaa',
        environment: 'production',
        eventTime: '123',
        isNonMigratory: false,
        isDarkDeploy: true,
      },
    }),
    Effect.provide(Layer.succeed(Signaling, signaling)),
    Runtime.runPromiseExit(runtime)
  )

  await pipe(
    signaling.route({
      type: 'diachronic.ci.workflow.rollout.start',
      payload: {
        workflowName: 'wfname',
        versionId: 'vid',
        sha: 'shaa',
        environment: 'production',
        eventTime: '123',
      },
    }),
    Effect.provide(Layer.succeed(Signaling, signaling)),
    Runtime.runPromiseExit(runtime)
  )

  await ciDone

  expect(ctx.self.close).toHaveBeenCalledTimes(1)
  const context = pipe(dbFx.deref(), Effect.runSync)
  expect(Object.keys(context.workflows).sort()).toEqual([
    'migration',
    'rollout',
  ])
  expect(
    R.omit(['workflows', 'previousVersion', 'simulations'], context)
  ).toEqual({
    config: {
      environment: 'production',
      eventTime: '123',
      isDarkDeploy: true,
      isNonMigratory: false,
      sha: 'shaa',
      versionId: 'vid',
      workflowName: 'wfname',
    },
    fromVersion: {
      environment: 'development',
      flagName: 'workflow.wfname.seqId.001.version.def',
      seqId: '001',
      taskQueue: 'wfname-def',
      versionId: 'def',
      workflowName: 'wfname',
    },
    allWorkflowFlags: [
      {
        environment: 'development',
        flagName: 'workflow.wfname.seqId.001.version.def',
        seqId: '001',
        taskQueue: 'wfname-def',
        versionId: 'def',
        workflowName: 'wfname',
      },
      {
        environment: 'development',
        flagName: 'workflow.wfname.seqId.000.version.abc',
        seqId: '000',
        taskQueue: 'wfname-abc',
        versionId: 'abc',
        workflowName: 'wfname',
      },
    ],
    toVersion: {
      flagName: 'workflow.wfname.seqId.002.version.vid',
      seqId: '002',
      taskQueue: 'wfname-vid',
      versionId: 'vid',
      workflowName: 'wfname',
    },
  })
})

test('non-migratory', async () => {
  const ciDone = new Trigger()

  const fakes: CIWorkflowActivities & CIWorkflowWorkflows = {
    // Activities
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

    // Workflows
    migration: {
      startChild: (args) =>
        Effect.succeed({
          cancel: () => Effect.succeed(Effect.void),
          signal: () => Effect.succeed('OK'),
          result: () =>
            pipe(
              Effect.sleep(500),
              Effect.flatMap(() =>
                Effect.succeed(Exit.succeed({ x: 'exit from  migration' }))
              )
            ),
          workflowId: 'workflowId',
          firstExecutionRunId: 'firstExecutionRunId',
        }),
      executeChild: (args) => Effect.succeed('OK'),
    },
    rollout: {
      executeChild: (args) => Effect.succeed('OK'),
      startChild: (args) =>
        Effect.succeed({
          cancel: () => Effect.succeed(Effect.void),
          signal: () => Effect.succeed('OK'),
          result: () =>
            pipe(
              Effect.sleep(1500),
              Effect.flatMap(() =>
                Effect.succeed(Exit.succeed({ x: 'exit from rollout' }))
              )
            ),
          workflowId: 'workflowId',
          firstExecutionRunId: 'firstExecutionRunId',
        }),
    },
    cleanup: {
      executeChild: (args) => Effect.succeed('OK'),
      startChild: (args) =>
        Effect.succeed({
          cancel: () => Effect.succeed(Effect.void),
          signal: () => Effect.succeed('OK'),
          result: () =>
            pipe(
              Effect.sleep(1500),
              Effect.flatMap(() =>
                Effect.succeed(Exit.succeed({ x: 'exit from rollout' }))
              )
            ),
          workflowId: 'workflowId',
          firstExecutionRunId: 'firstExecutionRunId',
        }),
    },
  }

  const db = Ref.unsafeMake({} as any)
  const dbFx = DbFx(db)
  const ctx = {
    db: dbFx,
    fx: fakes,
    self: {
      signalWorkflow: () => Effect.fail('not implemented'),
      isContinueAsNewSuggested: () => Effect.succeed(false),
      continueAsNew: () => {
        throw new Error('continue as new')
      },
      close: jest.fn((args) =>
        Effect.sync(() => {
          if (Exit.isExit(args) && Exit.isSuccess(args)) {
            expect(
              // @ts-ignore
              args.value.x === 'exit from rollout' ||
                // @ts-ignore
                args.value.x === 'exit from  migration'
            ).toEqual(true)
          } else {
            expect(true).toEqual(false)
          }
          ciDone.resolve(undefined)
        })
      ),
    },
  }

  const runtime = pipe(
    Layer.succeed(Ctx, ctx),
    Layer.provideMerge(TemporalLogLayer('Trace')),
    Layer.toRuntime,
    Effect.scoped,
    Effect.runSync
  )
  const { signaling } = registerSignalHandlers(runtime)

  const migrationDoneHandler = jest.fn((args) => {
    expect(Exit.isExit(args)).toEqual(true)
    return Effect.void;
  })

  signaling.handle('migration.done', migrationDoneHandler)

  await pipe(
    signaling.route({
      type: 'diachronic.ci.workflow.deploy.success',
      payload: {
        workflowName: 'wfname',
        versionId: 'vid',
        sha: 'shaa',
        environment: 'production',
        eventTime: '123',
        isNonMigratory: true,
        isDarkDeploy: false,
      },
    }),
    Effect.provide(Layer.succeed(Signaling, signaling)),
    Runtime.runPromiseExit(runtime)
  )

  await ciDone

  expect(migrationDoneHandler).toHaveBeenCalledTimes(0)
  expect(ctx.self.close).toHaveBeenCalledTimes(1)

  const context = pipe(dbFx.deref(), Effect.runSync)
  expect(Object.keys(context.workflows).sort()).toEqual(['cleanup', 'rollout'])
  expect(
    R.omit(['workflows', 'previousVersion', 'simulations'], context)
  ).toEqual({
    config: {
      environment: 'production',
      eventTime: '123',
      isDarkDeploy: false,
      isNonMigratory: true,
      sha: 'shaa',
      versionId: 'vid',
      workflowName: 'wfname',
    },
    fromVersion: {
      environment: 'development',
      flagName: 'workflow.wfname.seqId.001.version.def',
      seqId: '001',
      taskQueue: 'wfname-def',
      versionId: 'def',
      workflowName: 'wfname',
    },
    allWorkflowFlags: [
      {
        environment: 'development',
        flagName: 'workflow.wfname.seqId.001.version.def',
        seqId: '001',
        taskQueue: 'wfname-def',
        versionId: 'def',
        workflowName: 'wfname',
      },
      {
        environment: 'development',
        flagName: 'workflow.wfname.seqId.000.version.abc',
        seqId: '000',
        taskQueue: 'wfname-abc',
        versionId: 'abc',
        workflowName: 'wfname',
      },
    ],
    toVersion: {
      flagName: 'workflow.wfname.seqId.002.version.vid',
      seqId: '002',
      taskQueue: 'wfname-vid',
      versionId: 'vid',
      workflowName: 'wfname',
    },
  })
})
test.skip('forked', async () => {
  let callback = jest.fn()

  const handler = (value: any) =>
    pipe(
      Effect.tryPromise(async () => 42),
      Effect.runFork,
      // race condition...?
      (fiber) => {
        fiber.addObserver(callback)
        return fiber
      },
      Effect.succeed
    )

  const test1 = (event: string, value: any) =>
    pipe(handler(value), Effect.runFork)

  const fiber = test1('ok', 42)
  await Effect.runPromise(fiber.await)
  expect(callback).toHaveBeenCalled()
})
