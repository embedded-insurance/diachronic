import * as wf from '@temporalio/workflow'
import {
  Cause,
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  pipe,
  Ref,
  Runtime,
} from 'effect'
import { mapGroupToScheduleActivities } from '@diachronic/workflow/activities'
import { DbFx } from './lib/dbfx'
import { workflowDefinitions } from './activities/definitions'
import { DateTime } from 'luxon'
import { FlagStrategy } from '@diachronic/toolbox/infra/feature-flag-config'
import { ApplicationFailure } from '@temporalio/workflow'
import { TemporalLogLayer } from '@diachronic/workflow/workflow-logging'

export type RolloutWorkflowArgs = {
  // Name of the workflow to migrate
  workflowName: string
  // The version to migrate to
  toVersion: {
    flagName: string
    versionId: string
    seqId: string
    environment: any
    taskQueue: string
  }
  // What the rollout should start at (number between 0 and 100)
  // Default: 0
  initialRolloutPercent?: number
  // What the rollout should increase by each step (number between 0 and 100)
  // Default: 10
  stepPercent?: number
  // Number of seconds to wait between each rollout step
  // Default: 60
  stepIntervalSeconds?: number
  // What the rollout should stop at (number between 0 and 100)
  // Default: 100
  maxRolloutPercent?: number

  // The version to migrate from (currently not used)
  // fromVersion?: {
  //   flagName: string
  //   versionId: string
  //   seqId: string
  //   environment: any
  //   taskQueue: string
  // }
}

// Args + defaults
type RolloutWorkflowConfig = RolloutWorkflowArgs & {
  initialRolloutPercent: number
  stepPercent: number
  stepIntervalSeconds: number
  maxRolloutPercent: number
}

export type RolloutDb = {
  config: RolloutWorkflowConfig
  currentStep: {
    fromPercent: number
    toPercent: number
    scheduledAt: number
  }
}

const activities = mapGroupToScheduleActivities(
  workflowDefinitions.rollout['temporal.workflow'].activities
)

export const RolloutCtx = Context.GenericTag<{
  db: DbFx<RolloutDb>
  fx: typeof activities
}>("@services/RolloutCtx")
export const isGeneralTrafficStrategy = (x: FlagStrategy) =>
  x.name === 'flexibleRollout' && x.title === 'All other traffic'

const isAutomatedGeneralTrafficRolloutEnabled = (
  expectedPercent: string,
  args: FlagStrategy[] | readonly FlagStrategy[]
) => {
  const strategy = args.find(isGeneralTrafficStrategy)
  if (!strategy) {
    return pipe(
      Effect.logInfo('General traffic strategy not found'),
      Effect.annotateLogs({ strategies: args }),
      Effect.flatMap(() =>
        Effect.die({
          _tag: 'GeneralTrafficStrategyNotFound',
          message: `General traffic strategy not found`,
          strategies: args,
        })
      )
    )
  }
  const rollout = strategy.parameters.rollout
  if (rollout !== expectedPercent) {
    return pipe(
      Effect.logInfo('Flag has a rollout percent that is not expected'),
      Effect.annotateLogs({
        expected: expectedPercent,
        actual: rollout,
        strategy,
      }),
      Effect.flatMap(() =>
        Effect.die({
          _tag: 'RolloutPercentNotExpected',
          message: `Flag has a rollout percent that is not expected`,
          expected: expectedPercent,
          actual: rollout,
          strategy,
          nonRetryable: true,
        })
      )
    )
  }
  if (strategy.disabled) {
    return pipe(
      Effect.logInfo('General traffic strategy is disabled'),
      Effect.annotateLogs({ strategy }),
      Effect.flatMap(() =>
        Effect.die({
          _tag: 'GeneralTrafficStrategyDisabled',
          message: `General traffic strategy is disabled`,
          strategy,
          nonRetryable: true,
        })
      )
    )
  }
  return pipe(
    Effect.logInfo('Current rollout percent setting matched expectation'),
    Effect.annotateLogs({
      actual: rollout,
      expected: expectedPercent,
      strategy,
    }),
    Effect.flatMap(() => Effect.void)
  );
}

// Written for a single flag that controls both workflow start
// and migration of running workflows when a previous version
export const program = (args: RolloutWorkflowConfig) =>
  Effect.flatMap(RolloutCtx, ({ fx, db }) => {
    const rollout = (percent: number) =>
      pipe(
        fx.applyWorkflowTrafficRouting({
          workflowFlagName: args.toVersion.flagName,
          percent: String(percent),
        }),
        Effect.map((result) => ({
          result,
          percent,
        }))
      )

    const {
      initialRolloutPercent,
      maxRolloutPercent,
      stepPercent,
      stepIntervalSeconds,
    } = args

    return Effect.loop(
      // start processing the interval
      initialRolloutPercent + stepPercent,
      {
        while: (percent) => percent <= maxRolloutPercent,
        body: (percent) => {
          const fromPercent = percent - stepPercent
          const toPercent = percent
          return pipe(
            Clock.currentTimeMillis,
            Effect.flatMap((now) =>
              pipe(
                Effect.logInfo(
                  `Rollout of ${args.workflowName} at version ${
                    args.toVersion.versionId
                  } from ${fromPercent}% to ${toPercent}% is scheduled for ${DateTime.fromMillis(
                    now + stepIntervalSeconds * 1000,
                    { zone: 'utc' }
                  ).toISO()} (${stepIntervalSeconds} seconds from now)})`
                ),
                Effect.flatMap(() =>
                  db.assoc('currentStep', {
                    fromPercent,
                    toPercent,
                    scheduledAt: now + stepIntervalSeconds * 1000,
                  })
                )
              )
            ),
            Effect.flatMap(() =>
              Effect.sleep(Duration.seconds(stepIntervalSeconds))
            ),
            Effect.flatMap(() =>
              pipe(
                Effect.Do,
                Effect.bind('strategies', () =>
                  fx.getFlagStrategies({
                    flagName: args.toVersion.flagName,
                    environment: args.toVersion.environment,
                  })
                ),
                Effect.bind('fromPercent', () =>
                  pipe(
                    db.get('currentStep'),
                    Effect.map((x) => x.fromPercent!)
                  )
                ),
                Effect.flatMap(({ strategies, fromPercent }) =>
                  isAutomatedGeneralTrafficRolloutEnabled(
                    String(fromPercent),
                    strategies as any[]
                  )
                )
              )
            ),
            Effect.flatMap(() => rollout(percent)),
            Effect.flatMap((result) =>
              pipe(
                Effect.logInfo(
                  `${args.workflowName} version ${args.toVersion.versionId} is set to ${percent}% for all new and existing traffic.`
                ),
                Effect.flatMap(() => Effect.succeed(result.percent))
              )
            ),
            Effect.catchAllCause((e) => {
              if (Cause.isDie(e)) {
                return Effect.die(e)
              }
              return pipe(
                Effect.logError(
                  `An error occurred when increasing traffic to ${percent}%. Retrying.`,
                  e
                ),
                // Effect.flatMap(() => Effect.sleep(Duration.seconds(60))),
                Effect.flatMap(() => Effect.succeed(fromPercent))
              )
            })
          )
        },
        step: (percent) => {
          // console.log('step....', percent)
          return percent + stepPercent
        },
        // Don't accumulate return values from body (return void)
        discard: true,
      }
    )
  })

const defaults = {
  initialRolloutPercent: 0,
  stepPercent: 10,
  stepIntervalSeconds: 60,
  maxRolloutPercent: 100,
}

/**
 * A workflow that automatically rolls out traffic to new workflow versions
 * Halts when cancelled via Temporal API or new version reaches 100% rolled out
 * @param args
 */
export const rollout = async (args: RolloutWorkflowArgs) => {
  const blocker = new wf.Trigger()

  const config = { ...defaults, ...args } as RolloutWorkflowConfig
  const db = Ref.unsafeMake<RolloutDb>({ config } as RolloutDb)
  const dbFx = DbFx(db)
  const runtime = pipe(
    Layer.succeed(RolloutCtx, { db: dbFx, fx: activities }),
    Layer.provideMerge(TemporalLogLayer('Trace')),
    Layer.toRuntime,
    Effect.scoped,
    Effect.runSync
  )

  wf.setHandler(wf.defineQuery('db'), () => dbFx.deref())

  pipe(program(config), Runtime.runPromiseExit(runtime))
    .then((x) =>
      x._tag === 'Failure'
        ? blocker.reject(
            ApplicationFailure.create({
              type: 'Exit',
              message: 'Fail',
              cause: new Error(x.cause.toString()),
              details: [x],
              nonRetryable: true,
            })
          )
        : blocker.resolve(x)
    )
    .catch((e) => blocker.reject(e))

  return blocker
}
