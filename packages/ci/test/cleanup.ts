import { Duration, Effect, Layer, pipe, Ref, Runtime } from 'effect'
import * as fc from 'fast-check'
import { getArbitrary, sample1 } from '@diachronic/util/arbitrary'
import * as S from '@effect/schema/Schema'
import * as R from 'ramda'
import { CallableGroup } from '@diachronic/activity/effect'
import { TestClock } from '@diachronic/migrate/clock'
import { sleep } from '@diachronic/util/sleep'
import { TemporalLogLayer } from '@diachronic/workflow/workflow-logging'
import { DbFx } from '../src/lib/dbfx'
import { Self } from '../src/lib/self'
import { workflowDefinitions } from '../src/activities/definitions'
import {
  CleanupCtx,
  CleanupDb,
  CleanupWorkflowArgs,
  program,
} from '../src/workflow-cleanup'

jest.setTimeout(30_000)

const fakeFx = (
  state: Record<string, any>
): CallableGroup<
  (typeof workflowDefinitions.cleanup)['temporal.workflow']['activities']
> => ({
  getRunningWorkflowIdsCount: function (args: {
    readonly workflowName?: string | undefined
    readonly taskQueue: string
  }): Effect.Effect<never, unknown, number> {
    const idx = fc.sample(
      fc.integer({ min: 0, max: state.oldRunningWorkflowIds.length }),
      1
    )
    const total = state.oldRunningWorkflowIds.length
    const toMigrate = state.oldRunningWorkflowIds.slice(0, idx)
    state.oldRunningWorkflowIds.splice(0, idx)
    // return Effect.succeed({
    //   toMigrate,
    //   numberRemaining: total - 1,
    // })
    return Effect.succeed(state.oldRunningWorkflowIds.length)
  },
  getWorkflowDeployments: function (args: {
    readonly workflowName?: string
    readonly versionId?: string
  }): Effect.Effect<never, unknown, readonly unknown[]> {
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
  }): Effect.Effect<never, unknown, string> {
    return Effect.succeed('OK')
  },
  deleteWorkflowVersionFlag: function (args: {
    readonly environment?: string | undefined
    readonly workflowName: string
    readonly versionId: string
  }): Effect.Effect<never, unknown, unknown> {
    return Effect.succeed('OK')
  },
})

test('workflow cleanup workflow', async () => {
  const args: CleanupWorkflowArgs = {
    versionInfo: {
      environment: 'development',
      flagName: 'workflow.wfname.seqId.001.version.def',
      seqId: '001',
      taskQueue: 'wfname-def',
      versionId: 'def',
      workflowName: 'wfname',
    },
  }
  const config = { iterMs: 60_000, ...args }
  const db = Ref.unsafeMake({
    config,
    removableDeployments: [] as any[],
    numberOfWorkflows: null as unknown as number,
  })
  const dbFx = DbFx<CleanupDb>(db)

  const oldRunningWorkflowIds = sample1(
    fc.array(getArbitrary(S.UUID), { maxLength: 10 })
  )

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
    Layer.succeed(CleanupCtx, {
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

  expect(R.omit(['summary'], dbValue)).toEqual({
    config: {
      iterMs: 60000,
      versionInfo: {
        environment: 'development',
        flagName: 'workflow.wfname.seqId.001.version.def',
        seqId: '001',
        taskQueue: 'wfname-def',
        versionId: 'def',
        workflowName: 'wfname',
      },
    },
    numberOfWorkflows: null,
    removableDeployments: [
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: {
          labels: {
            'diachronic/version-id': 'def',
            'diachronic/workflow-name': 'wfname',
          },
          name: 'mydeployment',
          namespace: 'mynamespace',
        },
      },
    ],
  })
})
