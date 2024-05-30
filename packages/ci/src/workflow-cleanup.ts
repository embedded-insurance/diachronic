import * as S from '@effect/schema/Schema'
import * as R from 'ramda'
import * as wf from '@temporalio/workflow'
import {
  Context,
  Duration,
  Effect,
  Layer,
  pipe,
  Ref,
  Runtime,
  Schedule,
} from 'effect'
import { mapGroupToScheduleActivities } from '@diachronic/workflow/activities'
import { TemporalLogLayer } from '@diachronic/workflow/workflow-logging'
import { workflowDefinitions } from './activities/definitions'
import { DbFx } from './lib/dbfx'
import { Self } from './lib/self'
// import { Deployment } from '@ei-tech/k8s-api/v1/Deployment'
type Deployment = any

const schedule = mapGroupToScheduleActivities(
  workflowDefinitions.cleanup['temporal.workflow'].activities
)

export type CleanupWorkflowArgs = S.Schema.Type<
  (typeof workflowDefinitions.cleanup)['input']
>

export type CleanupWorkflowConfig = CleanupWorkflowArgs & { iterMs: number }

export type CleanupDb = {
  config: CleanupWorkflowConfig
  removableDeployments: Deployment[]
  numberOfWorkflows: number
  summary?: {
    numberOfIterations: number
  }
}

export const CleanupCtx = Context.GenericTag<{
  db: DbFx<CleanupDb>
  fx: typeof schedule
  self: Self<CleanupDb>
}>('@services/CleanupCtx')

export const program = (args: CleanupWorkflowConfig) =>
  Effect.flatMap(CleanupCtx, ({ fx, db, self }) => {
    const taskQueueIsEmpty = pipe(
      pipe(
        Effect.Do,
        Effect.bind('unmigratedWorkflowIds', () =>
          pipe(
            fx.getRunningWorkflowIdsCount(
              {
                // todo. when more than one workflow per deployment,
                // we can safely remove that deployment when there are
                // none of those workflow types running
                // This waits for the task queue to be empty of all activity.
                // It's unlikely  worker is running different workflows on the same task queue (and we could remove
                // this k8s deployment sooner) but I think there ends up being a 1-to-1 correspondence between
                // a k8s deployment and a task queue anyway
                taskQueue: args.versionInfo.taskQueue,
              },
              { retry: { maximumAttempts: 1 } }
            ),
            Effect.tap((count) =>
              Effect.logInfo(`${count} workflows are running on the task queue`)
            )
          )
        ),
        // Retry/recur while unmigrated workflows
        Effect.filterOrFail(
          ({ unmigratedWorkflowIds }) => unmigratedWorkflowIds === 0,
          (e) => ({
            message: `${e.unmigratedWorkflowIds} ${
              e.unmigratedWorkflowIds <= 1 ? 'workflow is' : 'workflows are'
            } still running on task queue ${args.versionInfo.taskQueue})`,
            taskQueue: args.versionInfo.taskQueue,
            numberRemaining: e.unmigratedWorkflowIds,
          })
        )
      ),
      Effect.retry(
        pipe(
          // todo. Add to config
          Schedule.intersect(
            Schedule.recurs(Infinity),
            Schedule.spaced(Duration.millis(args.iterMs))
          ),
          Schedule.tapInput((x) =>
            pipe(
              Effect.logDebug('Schedule input'),
              Effect.annotateLogs({ scheduleInput: x })
            )
          ),
          Schedule.untilOutputEffect(() =>
            pipe(
              self.isContinueAsNewSuggested(),
              Effect.flatMap((shouldContinueAsNew) =>
                Effect.if(shouldContinueAsNew, {
                  onTrue: () =>
                    pipe(
                      db.deref(),
                      Effect.flatMap((state) => self.continueAsNew(state)),
                      Effect.matchEffect({
                        onSuccess: () => Effect.succeed(true),
                        onFailure: () => Effect.succeed(false),
                      })
                    ),
                  onFalse: () => Effect.succeed(false),
                })
              )
            )
          ),
          // Schedule.tapOutput((x) => Console.log('Schedule output', x)),
          Schedule.tapOutput((x) =>
            db.swap((state) =>
              R.assocPath(['summary', 'numberOfIterations'], x[1], state)
            )
          )
        )
      ),
      Effect.tap((data) => Effect.logInfo('Migration complete.'))
    )

    return pipe(
      taskQueueIsEmpty,

      Effect.bind('removableDeployments', () =>
        pipe(
          fx.getWorkflowDeployments(args.versionInfo),
          // We typically expect there to be a deployment here. Returning as an error will show in temporal already
          // Also log as warning
          Effect.catchTag('NoDeploymentsFound', (e) =>
            pipe(
              Effect.logWarning(
                'Expected to find deployments. Maybe they were already removed.',
                e
              ),
              Effect.tap(() => Effect.succeed([]))
            )
          ),
          Effect.tap((deployments) =>
            db.assoc('removableDeployments', deployments as Deployment[])
          )
        )
      ),
      Effect.bind('removedDeployments', ({ removableDeployments }) =>
        pipe(
          removableDeployments as Deployment[],
          Effect.partition((deployment) =>
            fx.deleteKubernetesDeployment({
              name: deployment.metadata!.name!,
              namespace: deployment.metadata!.namespace!,
            })
          ),
          Effect.flatMap(([failures, successes]) => {
            if (failures.length) {
              return pipe(
                Effect.logWarning(
                  'Some deployments failed to delete. We will assume it is fine and continue anyway...'
                ),
                Effect.annotateLogs({ failedDeploymentRemovals: { failures } }),
                Effect.flatMap(() => Effect.succeed({ successes, failures }))
              )
            }
            return Effect.succeed({ successes, failures })
          })
        )
      ),
      Effect.bind('removedOldFlag', () =>
        fx.deleteWorkflowVersionFlag(args.versionInfo)
      )
    )
  })

export const cleanup = async (args: CleanupWorkflowArgs) => {
  const blocker = new wf.Trigger()

  const config: CleanupWorkflowConfig = { iterMs: 60_000 * 5, ...args }
  const db = Ref.unsafeMake({
    config,
    removableDeployments: [] as any[],
    numberOfWorkflows: null as unknown as number,
  })
  const dbFx = DbFx<CleanupDb>(db)
  const self = Self.make(blocker)
  const runtime = pipe(
    Layer.succeed(CleanupCtx, {
      db: dbFx,
      fx: schedule,
      self,
    }),
    Layer.provideMerge(TemporalLogLayer('Trace')),
    Layer.toRuntime,
    Effect.scoped,
    Effect.runSync
  )
  wf.setHandler(wf.defineQuery('db'), () => dbFx.deref())

  pipe(program(config), Runtime.runPromiseExit(runtime))
    .then((x) =>
      x._tag === 'Success' ? blocker.resolve(x) : blocker.reject(x)
    )
    .catch((e) => blocker.reject(e))

  return blocker
}
