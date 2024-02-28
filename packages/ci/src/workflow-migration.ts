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

// copied because workflow
export const workflowTaskQueueName = ({
  workflowName,
  versionId,
}: {
  workflowName: string
  versionId: string
}) => [workflowName, versionId].join('-')
const versionIdFromTaskQueue = (s: string) => s.split('-')[1]
//

const schedule = mapGroupToScheduleActivities(
  workflowDefinitions.migration['temporal.workflow'].activities,
  {
    signalMigrationBatch: {
      retry: {
        maximumAttempts: 1,
      },
    },
  }
)

export type MigrationWorkflowArgs = {
  workflowName: string
  fromTaskQueue: string
  toTaskQueue: string
  environment: 'development' | 'production'
  iterMs?: number
}
export type MigrationWorkflowConfig = {
  workflowName: string
  fromTaskQueue: string
  toTaskQueue: string
  environment: 'development' | 'production'
  iterMs: number
}
export type MigrateDb = {
  config: MigrationWorkflowConfig
  events: any[]
  signaledWorkflows: string[]
  unmigratedWorkflows: string[]
  removableDeployments: Deployment[]
  summary?: {
    numberOfIterations: number
  }
}

export const MigrateCtx = Context.Tag<{
  db: DbFx<MigrateDb>
  fx: typeof schedule
  self: Self<MigrateDb, any>
}>()

export const program = (args: MigrationWorkflowConfig) =>
  Effect.flatMap(MigrateCtx, ({ fx, db, self }) => {
    const migrateAll = pipe(
      pipe(
        Effect.Do,
        Effect.bind('signaled', () => db.get('signaledWorkflows')),
        Effect.bind('currentBatchToSignal', ({ signaled }) =>
          pipe(
            fx.getWorkflowIdsToMigrateToTaskQueueByFeatureFlag({
              workflowName: args.workflowName,
              fromTaskQueue: args.fromTaskQueue,
              toTaskQueue: args.toTaskQueue,
            }),
            Effect.tap(({ toMigrate }) =>
              Effect.logInfo(
                `Found ${toMigrate.length} workflows eligible for migration`
              )
            ),
            Effect.map((x) => R.difference(x.toMigrate, signaled))
          )
        ),
        Effect.bind('migrationResult', ({ currentBatchToSignal: toSignal }) =>
          Effect.if(toSignal.length > 0, {
            onTrue: pipe(
              Effect.logInfo(
                `Sending migration signal to ${toSignal.length} workflows`
              ),
              Effect.flatMap(() =>
                pipe(
                  fx.signalMigrationBatch({
                    workflowIds: toSignal,
                    taskQueue: args.toTaskQueue,
                  }),
                  Effect.flatMap((result) =>
                    db.updateIn('signaledWorkflows', (xs = []) => [
                      ...xs,
                      ...result.successes,
                    ])
                  )
                )
              )
            ),
            onFalse: Effect.logInfo('Nothing new to signal'),
          })
        ),
        Effect.bind('unmigratedWorkflowIds', () =>
          pipe(
            fx.getRunningWorkflowIds(
              {
                workflowName: args.workflowName,
                taskQueue: args.fromTaskQueue,
              },
              { retry: { maximumAttempts: 1 } }
            ),
            Effect.tap((ids) =>
              Effect.logInfo(
                `${ids.length} workflows are now on the old version`
              )
            ),
            Effect.tap((ids) =>
              db.assoc('unmigratedWorkflows', ids as string[])
            )
          )
        ),
        // Retry/recur while unmigrated workflows
        Effect.filterOrFail(
          ({ unmigratedWorkflowIds }) => unmigratedWorkflowIds.length === 0,
          (e) => ({
            message: `${e.unmigratedWorkflowIds.length} ${
              e.unmigratedWorkflowIds.length <= 1
                ? 'workflow is'
                : 'workflows are'
            } still on the old version (${args.fromTaskQueue})`,
            fromTaskQueue: args.fromTaskQueue,
            toTaskQueue: args.toTaskQueue,
            numberRemaining: e.unmigratedWorkflowIds.length,
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
                  onTrue: pipe(
                    db.deref(),
                    Effect.flatMap((state) => self.continueAsNew(state)),
                    Effect.matchEffect({
                      onSuccess: () => Effect.succeed(true),
                      onFailure: () => Effect.succeed(false),
                    })
                  ),
                  onFalse: Effect.succeed(false),
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
      migrateAll,

      Effect.bind('removableDeployments', () =>
        pipe(
          fx.getWorkflowDeployments({
            workflowName: args.workflowName,
            versionId: versionIdFromTaskQueue(args.fromTaskQueue),
          }),
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
        fx.deleteWorkflowVersionFlag({
          environment: args.environment,
          workflowName: args.workflowName,
          versionId: versionIdFromTaskQueue(args.fromTaskQueue),
        })
      )
    )
  })

export const migration = async (args: MigrationWorkflowArgs) => {
  const blocker = new wf.Trigger()

  const config: MigrationWorkflowConfig = { iterMs: 60_000, ...args }
  const db = Ref.unsafeMake({
    config,
    events: [] as any[],
    signaledWorkflows: [] as string[],
    removableDeployments: [] as any[],
    unmigratedWorkflows: [] as string[],
  })
  const dbFx = DbFx<MigrateDb>(db)
  const self = Self.make(blocker)
  const runtime = pipe(
    Layer.succeed(MigrateCtx, {
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
