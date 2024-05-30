import * as R from 'ramda'
import { Duration, Effect, Layer, pipe, Ref, Runtime } from 'effect'
import { TemporalLogLayer } from '@diachronic/workflow/workflow-logging'
import * as fc from 'fast-check'
import { getArbitrary, sample1 } from '@diachronic/util/arbitrary'
import * as S from '@effect/schema/Schema'
import { workflowTaskQueueName } from '@diachronic/toolbox/infra/versioning'
import { CallableGroup } from '@diachronic/activity/effect'
import { TestClock } from '@diachronic/migrate/clock'
import { sleep } from '@diachronic/util/sleep'
import { Self } from '../src/lib/self'
import { DbFx } from '../src/lib/dbfx'
import { workflowDefinitions } from '../src/activities/definitions'
import {
  MigrateCtx,
  MigrateDb,
  MigrationWorkflowArgs,
  program,
} from '../src/workflow-migration'

jest.setTimeout(30_000)

const fakeFx = (
  state: Record<string, any>
): CallableGroup<
  (typeof workflowDefinitions.migration)['temporal.workflow']['activities']
> => ({
  getWorkflowIdsToMigrateToTaskQueueByFeatureFlag: (args: {
    workflowName: string
    fromTaskQueue: string
    toTaskQueue: string
  }) => {
    const idx = fc.sample(
      fc.integer({ min: 0, max: state.oldRunningWorkflowIds.length }),
      1
    )
    const total = state.oldRunningWorkflowIds.length
    const toMigrate = state.oldRunningWorkflowIds.slice(0, idx)
    state.oldRunningWorkflowIds.splice(0, idx)
    return Effect.succeed({
      toMigrate,
      numberRemaining: total - 1,
    })
  },
  getRunningWorkflowIds: function (args: {
    readonly workflowName?: string | undefined
    readonly taskQueue: string
  }): Effect.Effect<readonly string[], unknown> {
    return Effect.succeed(state.oldRunningWorkflowIds)
  },
  signalMigration: function (args: {
    readonly taskQueue: string
    readonly workflowId: string
  }): Effect.Effect<unknown, unknown> {
    return Effect.succeed('OK')
  },
  signalMigrationBatch: function (args: {
    readonly taskQueue: string
    readonly workflowIds: readonly string[]
  }): Effect.Effect<{ successes: string[]; failures: string[] }, unknown> {
    return Effect.succeed({
      successes: args.workflowIds as string[],
      failures: [],
    })
  },
  getWorkflowDeployments: function (args: {
    readonly workflowName?: string
    readonly versionId?: string
  }): Effect.Effect<readonly unknown[], unknown> {
    return Effect.succeed([
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: {
          name: 'mydeployment',
          namespace: 'mynamespace',
          labels: {
            'diachronic/workflow-name': args.workflowName,
            'diachronic/version-id': args.versionId,
          },
        },
      },
    ])
  },
  deleteKubernetesDeployment: function (args: {
    readonly name: string
    readonly namespace: string
  }): Effect.Effect<string, unknown> {
    return Effect.succeed('OK')
  },
  deleteWorkflowVersionFlag: function (args: {
    readonly environment?: string | undefined
    readonly workflowName: string
    readonly versionId: string
  }): Effect.Effect<unknown, unknown> {
    return Effect.succeed('OK')
  },
})

test('workflow migration workflow', async () => {
  const args: MigrationWorkflowArgs = {
    workflowName: 'mywf',
    environment: 'development' as 'development' | 'production',
    fromTaskQueue: workflowTaskQueueName({
      workflowName: 'myWorkflow',
      versionId: 'A',
    }),
    toTaskQueue: workflowTaskQueueName({
      workflowName: 'myWorkflow',
      versionId: 'B',
    }),
  }
  const config = { iterMs: 60_000, ...args }
  const db = Ref.unsafeMake({
    config,
    events: [] as any[],
    signaledWorkflows: [] as string[],
    removableDeployments: [] as any[],
    unmigratedWorkflows: [] as string[],
  })
  const dbFx = DbFx<MigrateDb>(db)

  const oldRunningWorkflowIds = sample1(
    fc.array(getArbitrary(S.UUID), { maxLength: 10 })
  )
  const allOldWorkflowIds = oldRunningWorkflowIds.slice(0)

  let testState = { oldRunningWorkflowIds }
  const clock = new TestClock()

  // todo. test continueAsNew
  let blocker = {
    resolve: (v: any) => {
      console.log('resolved', v)
    },
    reject: (v: any) => {
      console.log('rejected', v)
    },
  }
  const runtime = pipe(
    Layer.succeed(MigrateCtx, {
      db: dbFx,
      fx: fakeFx(testState),
      self: Self.of({
        signalWorkflow: () => Effect.fail('not implemented'),
        continueAsNew: () => Effect.succeed(true as never),
        close: () => Effect.succeed(true),
        isContinueAsNewSuggested: () => Effect.succeed(false),
      }),
    }),
    Layer.provideMerge(Layer.setClock(clock)),
    Layer.provideMerge(TemporalLogLayer('Trace')),
    Layer.toRuntime,
    Effect.scoped,
    Effect.runSync
  )

  const result = pipe(program(config), Runtime.runPromise(runtime))

  const timestep = async (t: number) => {
    clock.increment(Duration.toMillis(Duration.seconds(t)))
    await sleep(0)
  }
  const timesteps = async ({
    number,
    duration,
  }: {
    number: number
    duration: number
  }) => {
    for (let _ of R.range(0, number)) {
      await timestep(duration)
    }
  }

  await timesteps({ number: 10, duration: 60 })

  await result

  const dbValue = pipe(dbFx.deref(), Effect.runSync)
  // expect(typeof dbValue.summary?.numberOfIterations === 'number').toEqual(true)
  expect(R.omit(['summary'], dbValue)).toEqual({
    config: {
      environment: 'development',
      fromTaskQueue: 'myWorkflow-A',
      toTaskQueue: 'myWorkflow-B',
      workflowName: 'mywf',
      iterMs: 60_000,
    },
    events: [],
    removableDeployments: [
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: {
          labels: {
            'diachronic/version-id': 'A',
            'diachronic/workflow-name': 'mywf',
          },
          name: 'mydeployment',
          namespace: 'mynamespace',
        },
      },
    ],
    unmigratedWorkflows: [],
    signaledWorkflows: allOldWorkflowIds,
  })
})
