import * as R from 'ramda'
import { Clock, Duration, Effect, Layer, pipe, Ref, Runtime } from 'effect'
import { DbFx } from '../src/lib/dbfx'
import { program, RolloutCtx, RolloutDb } from '../src/workflow-rollout'
import { TestClock } from '@diachronic/migrate/clock'
import { sleep } from '@diachronic/util/sleep'
import { CallableGroup } from '@diachronic/activity/effect'
import { workflowDefinitions } from '../src/activities/definitions'
import { TemporalLogLayer } from '@diachronic/workflow/workflow-logging'

test('workflow rollout - no interrupt, flag rollout percent always matches what workflow expects', async () => {
  const config = {
    initialRolloutPercent: 0,
    maxRolloutPercent: 100,
    stepIntervalSeconds: 10,
    stepPercent: 10,
    workflowName: 'wfname',
    toVersion: {
      environment: 'development',
      flagName: 'workflow.wfname.seqId.002.version.vid',
      seqId: '002',
      versionId: 'vid',
      taskQueue: 'taskQueue',
    },
  }
  const clock = new TestClock()
  const db = Ref.unsafeMake({ config } as RolloutDb)
  const dbFx = DbFx<RolloutDb>(db)

  const fakes: CallableGroup<
    (typeof workflowDefinitions.rollout)['temporal.workflow']['activities']
  > = {
    // Activities
    applyWorkflowTrafficRouting: function (args: {
      readonly environment?: string | undefined
      readonly workflowFlagName: string
      readonly percent: string
    }): Effect.Effect<never, unknown, { readonly flagName: string }> {
      return Effect.succeed({ flagName: args.workflowFlagName })
    },
    getFlagStrategies: () => {
      return pipe(
        dbFx.get('currentStep'),
        Effect.map((x) => [
          {
            id: '123',
            name: 'flexibleRollout',
            title: 'All other traffic',
            constraints: [],
            parameters: {
              rollout: String(x.fromPercent),
              stickiness: 'default', // todo. orgId | sessionId | default | random?
              groupId: '',
            },
            variants: [],
            segments: [],
            disabled: false,
          },
        ])
      )
    },
  }

  const runtime = pipe(
    Layer.succeed(RolloutCtx, {
      db: dbFx,
      fx: fakes,
    }),
    Layer.provideMerge(TemporalLogLayer('Trace')),
    Layer.provideMerge(Layer.succeed(Clock.Clock, clock)),
    Layer.provideMerge(Layer.setClock(clock)),
    Layer.toRuntime,
    Effect.scoped,
    Effect.runSync
  )

  const process = pipe(program(config), Runtime.runPromise(runtime))

  const timestep = async (t: number) => {
    clock.increment(Duration.toMillis(Duration.seconds(t)))
    await sleep(0)
  }

  for (let _ of R.range(0, 10)) {
    await timestep(10_000)
  }

  const context = pipe(dbFx.deref(), Effect.runSync)

  await process

  expect(context).toEqual({
    config: {
      initialRolloutPercent: 0,
      maxRolloutPercent: 100,
      stepIntervalSeconds: 10,
      stepPercent: 10,
      toVersion: {
        environment: 'development',
        flagName: 'workflow.wfname.seqId.002.version.vid',
        seqId: '002',
        taskQueue: 'taskQueue',
        versionId: 'vid',
      },
      workflowName: 'wfname',
    },
    currentStep: {
      fromPercent: 90,
      scheduledAt: 90010000,
      toPercent: 100,
    },
  })
})

test('workflow rollout - with interrupt', async () => {
  const config = {
    initialRolloutPercent: 0,
    maxRolloutPercent: 100,
    stepIntervalSeconds: 10,
    stepPercent: 10,
    workflowName: 'wfname',
    toVersion: {
      environment: 'development',
      flagName: 'workflow.wfname.seqId.002.version.vid',
      seqId: '002',
      versionId: 'vid',
      taskQueue: 'taskQueue',
    },
  }

  const clock = new TestClock()
  const db = Ref.unsafeMake({ config } as RolloutDb)
  const dbFx = DbFx(db)

  const fakes: CallableGroup<
    (typeof workflowDefinitions.rollout)['temporal.workflow']['activities']
  > = {
    // Activities
    applyWorkflowTrafficRouting: function (args: {
      readonly environment?: string | undefined
      readonly workflowFlagName: string
      readonly percent: string
    }): Effect.Effect<never, unknown, { readonly flagName: string }> {
      return Effect.succeed({ flagName: args.workflowFlagName })
    },
    getFlagStrategies: () => {
      console.log('ok then...')
      return Effect.succeed([
        {
          id: '123',
          name: 'flexibleRollout',
          title: 'All other traffic',
          constraints: [],
          parameters: {
            rollout: '42',
            stickiness: 'default', // todo. orgId | sessionId | default | random?
            groupId: '',
          },
          variants: [],
          segments: [],
          disabled: false,
        },
      ])
    },
  }
  const runtime = pipe(
    Layer.succeed(RolloutCtx, {
      db: dbFx,
      fx: fakes,
    }),
    Layer.provideMerge(TemporalLogLayer('Trace')),
    Layer.provideMerge(Layer.succeed(Clock.Clock, clock)),
    Layer.provideMerge(Layer.setClock(clock)),
    Layer.toRuntime,
    Effect.scoped,
    Effect.runSync
  )

  const process = pipe(program(config), Runtime.runPromiseExit(runtime)).catch(
    (e) => {
      console.log('wha', e)
      expect((e as any)._tag).toEqual('RolloutPercentNotExpected')
    }
  )

  const timestep = async (t: number) => {
    clock.increment(Duration.toMillis(Duration.seconds(t)))
    await sleep(0)
  }

  for (let _ of R.range(0, 10)) {
    await timestep(10_000)
  }

  const result = await process.catch((e) => {
    expect((e as any)._tag).toEqual('RolloutPercentNotExpected')
  })
  expect(
    result && result.toJSON()
    // &&
    //   Exit.isFailure(result) &&
    //   Cause.isDie(result.cause) &&
    //   Chunk.toReadonlyArray(Cause.defects(result.cause))
  ).toEqual({
    _id: 'Exit',
    _tag: 'Failure',
    cause: {
      _id: 'Cause',
      _tag: 'Die',
      defect: {
        _id: 'Cause',
        _tag: 'Die',
        defect: {
          _tag: 'RolloutPercentNotExpected',
          actual: '42',
          expected: '0',
          message: 'Flag has a rollout percent that is not expected',
          nonRetryable: true,
          strategy: {
            constraints: [],
            disabled: false,
            id: '123',
            name: 'flexibleRollout',
            parameters: {
              groupId: '',
              rollout: '42',
              stickiness: 'default',
            },
            segments: [],
            title: 'All other traffic',
            variants: [],
          },
        },
      },
    },
  })
})
