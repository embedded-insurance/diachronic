import * as R from 'ramda'
import * as S from '@effect/schema/Schema'
import { Effect, Layer, pipe } from 'effect'
import {
  implement,
  implementGroup,
  makeActivitiesAsync,
  makeActivitiesRuntime,
} from '@diachronic/activity/activity'
import { WorkflowSignalerClientLayer } from '@diachronic/signaler/client'
import {
  applyWorkflowTrafficRouting,
  applyWorkflowVersionFlag,
  deleteWorkflowVersionFlag,
  FeatureFlagConfigClient,
  getWorkflowFlagParts,
  makeFeatureFlagConfigClientLayer,
} from '@diachronic/toolbox/infra/feature-flag-config'
import { listWorkflowIds, signalMigrate } from '@diachronic/toolbox/migrate'
import { createTemporalClientLayer } from '@effect-use/temporal-client'
import { TemporalLogLayer } from '@diachronic/workflow/workflow-logging'
import {
  FeatureFlagClient,
  makeFeatureFlagClientLayer,
} from '@diachronic/feature-flag-client'
import { workflowTaskQueueName } from '@diachronic/toolbox/infra/versioning'
import { activities as simulationActivities } from './simulation'
import { activityDefinitions } from './definitions'
import { Kubectl, makeKubectl } from './kubectl'

const ActivitiesEnv = S.struct({
  FEATURE_FLAG_SERVER_URL: S.string,
  FEATURE_FLAG_CLIENT_API_KEY: S.string,
  FEATURE_FLAG_ADMIN_API_KEY: S.string,
  SIGNALER_BASE_URL: S.string,
  TEMPORAL_NAMESPACE: S.string,
  TEMPORAL_ADDRESS: S.string,
})

const env = S.decodeSync(ActivitiesEnv)(process.env as any, { errors: 'all' })

const getWorkflowIdsToMigrateToTaskQueueByFeatureFlag = (args: {
  workflowName: string
  fromTaskQueue: string
  toTaskQueue: string
}) =>
  pipe(
    listWorkflowIds({
      workflowName: args.workflowName,
      taskQueue: args.fromTaskQueue,
      executionStatus: 'Running',
    }),
    Effect.flatMap((runningOnFrom) =>
      Effect.flatMap(FeatureFlagClient, (client) =>
        pipe(
          Effect.all(
            runningOnFrom.map((id) =>
              client
                .getWorkflowTaskQueue({
                  workflowName: args.workflowName,
                  context: { userId: id },
                  defaultValue: '',
                })
                .pipe(Effect.map((taskQueue) => ({ id, taskQueue })))
            ),
            { mode: 'either' }
          ),
          Effect.flatMap((results) => {
            // For now we consider this a failure if the client returned one or if there is no value, indicating the default was used client-side
            const failures = results.filter(
              (x) =>
                x._tag === 'Left' || (x._tag === 'Right' && !x.right.taskQueue)
            )
            // Likewise, successes must return without failure but also have a non-defaulted value
            const successes = results
              .filter((x) => x._tag === 'Right' && x.right.taskQueue)
              .map((x) => (x as any).right as { id: string; taskQueue: string })

            // The workflows to migrate are the ones that the feature flag says should be on
            // the "to" task queue
            const toMigrate = successes
              .filter((x) => x.taskQueue === args.toTaskQueue)
              .map((x) => x.id)

            // Provide a count of the remaining as the sum of successes that should not be migrated yet
            // according to the feature flag rollout logic as well as the number of failures (subject to review,
            // as we may not be able to recover from the failures so the rollout stall if we wait
            // for numberRemaining to be 0
            const numberRemaining =
              successes.filter((x) => x.taskQueue !== args.toTaskQueue).length +
              failures.length

            return Effect.succeed({ toMigrate, numberRemaining })
          })
        )
      )
    )
  )

const signalMigration = implement(activityDefinitions.signalMigration, (args) =>
  signalMigrate(args.workflowId, args.taskQueue)
)

const signalMigrationBatch = implement(
  activityDefinitions.signalMigrationBatch,
  (args) =>
    pipe(
      Effect.partition(
        args.workflowIds,
        (workflowId) =>
          pipe(
            signalMigration({ workflowId, taskQueue: args.taskQueue }),
            Effect.map(() => workflowId),
            Effect.tapErrorCause(Effect.logWarning),
            Effect.mapError((x) => ({
              workflowId,
              error: x,
            }))
          ),
        { concurrency: 3 }
      ),
      Effect.flatMap((results) =>
        Effect.succeed({
          successes: results[1],
          failures: results[0].map((x) => x.workflowId),
        })
      )
    )
)

export const activities = implementGroup(activityDefinitions, {
  ...simulationActivities,
  getFlagStrategies: (args) =>
    Effect.flatMap(FeatureFlagConfigClient, (client) =>
      client.getFlagStrategies(args)
    ),
  getWorkflowDeployments: (args) =>
    Effect.flatMap(Kubectl, (kubectl) =>
      kubectl.get.deployment({
        labels: {
          'diachronic/workflow-name': args.workflowName,
          'diachronic/version-id': args.versionId,
        },
        allNamespaces: true,
      })
    ),
  getRunningWorkflowIds: (args) =>
    listWorkflowIds({
      ...args,
      executionStatus: 'Running',
    }),
  getRunningWorkflowIdsCount: (args) =>
    listWorkflowIds({
      ...args,
      executionStatus: 'Running',
    }).pipe(Effect.map((x) => x.length)),

  getWorkflowIdsToMigrateToTaskQueueByFeatureFlag,

  signalMigration,
  signalMigrationBatch,

  // Flags / Versioning
  applyWorkflowVersionFlag,
  applyWorkflowTrafficRouting,
  deleteWorkflowVersionFlag,
  getAllWorkflowVersionFlags: (args) =>
    Effect.flatMap(FeatureFlagConfigClient, (client) =>
      pipe(
        client.getWorkflowFlags({
          workflowName: args.workflowName,
          environment: args.environment,
        }),
        Effect.map((flags) =>
          flags.map((flag) => {
            const { versionId, seqId, workflowName } = getWorkflowFlagParts(
              flag.name
            )
            const taskQueue = workflowTaskQueueName({
              versionId: versionId,
              workflowName: args.workflowName,
            })

            return {
              workflowName,
              versionId,
              flagName: flag.name,
              taskQueue,
              seqId,
              environment: args.environment,
            }
          })
        )
      )
    ),

  // Kubernetes
  findKubernetesDeployments: (args) =>
    Effect.flatMap(Kubectl, (kubectl) => kubectl.get.deployment(args)),
  deleteKubernetesDeployment: (args) =>
    Effect.flatMap(Kubectl, (kubectl) => kubectl.delete.deployment(args)),
  getAllDeployedWorkflowVersions: (args) =>
    pipe(
      Effect.flatMap(Kubectl, (kubectl) =>
        kubectl.get.deployment({
          labels: { 'diachronic/workflow-name': args.workflowName },
          allNamespaces: true,
        })
      ),
      Effect.map((deployments) =>
        R.uniq(
          deployments
            .map((x) => x.metadata?.labels?.['diachronic/version-id'] || '')
            .filter(Boolean)
        )
      ),
      Effect.withLogSpan('getAllDeployedWorkflowVersions')
    ),
})

module.exports = makeActivitiesAsync(
  activityDefinitions,
  activities,
  makeActivitiesRuntime(
    pipe(
      WorkflowSignalerClientLayer({ baseURL: env.SIGNALER_BASE_URL }),
      Layer.provideMerge(Layer.succeed(Kubectl, makeKubectl())),
      Layer.provideMerge(
        createTemporalClientLayer({
          namespace: env.TEMPORAL_NAMESPACE,
          address: env.TEMPORAL_ADDRESS,
        })
      ),
      Layer.provideMerge(
        makeFeatureFlagClientLayer({
          serverURL: env.FEATURE_FLAG_SERVER_URL,
          apiKey: env.FEATURE_FLAG_CLIENT_API_KEY,
        })
      ),
      Layer.provideMerge(
        makeFeatureFlagConfigClientLayer({
          serverURL: env.FEATURE_FLAG_SERVER_URL,
          apiKey: env.FEATURE_FLAG_ADMIN_API_KEY,
        })
      )
    ),
    TemporalLogLayer('Trace')
  )
)
