import * as S from '@effect/schema/Schema'
import { activityDef } from '@diachronic/activity/activity'
import { ParentClosePolicy } from '@temporalio/workflow'
import { workflowDef } from '@diachronic/workflow/workflow'
import {
  CancelRolloutSignal,
  StartMigrationSignal,
  StartRolloutSignal,
} from '../signals'
import { WorkflowVersionInfo } from '@diachronic/toolbox/infra/versioning-types'
import { FeatureFlagEnvironment } from '@diachronic/toolbox/infra/feature-flag-config'
import { activityDefinitions as simulationActivityDefinitions } from './simulation/types'
import { NoDeploymentsFound, KubectlOpts } from './kubectl/types'
import { WorkflowDeploymentSuccessEvent } from '../types'

// todo.
const K8SDeployment = S.Unknown
const FlagStrategy = S.Struct({
  id: S.String,
  name: S.String,
  title: S.String,
  disabled: S.Boolean,
  parameters: S.optional(
    S.Struct({
      rollout: S.String,
      stickiness: S.String,
      groupId: S.String,
    })
  ),
})

export const SignalMigrationBatchOutput = S.Struct({
  successes: S.Array(S.String),
  failures: S.Array(S.String),
})
export const activityDefinitions = {
  ...simulationActivityDefinitions,
  getAllWorkflowVersionFlags: activityDef({
    name: 'getAllWorkflowVersionFlags',
    input: S.Struct({
      environment: S.optional(FeatureFlagEnvironment),
      workflowName: S.String,
    }),
    output: S.Array(WorkflowVersionInfo),
    error: S.Unknown,
  }),
  getAllDeployedWorkflowVersions: activityDef({
    name: 'getAllDeployedWorkflowVersions',
    description:
      'Returns all deployed workflow versions, unique by their version id, using the diachronic/version-id Kubernetes label',
    input: S.Struct({
      workflowName: S.String,
    }),
    output: S.Array(S.String),
    error: S.Unknown,
  }),
  getWorkflowIdsToMigrateToTaskQueueByFeatureFlag: activityDef({
    name: 'getWorkflowIdsToMigrateToTaskQueueByFeatureFlag',
    input: S.Struct({
      workflowName: S.String,
      fromTaskQueue: S.String,
      toTaskQueue: S.String,
    }),
    output: S.Struct({
      toMigrate: S.Array(S.String),
      numberRemaining: S.Number,
    }),
    error: S.Unknown,
  }),
  applyWorkflowVersionFlag: activityDef({
    name: 'applyWorkflowVersionFlag',
    input: S.Struct({
      environment: S.optional(FeatureFlagEnvironment),
      workflowName: S.String,
      versionId: S.String,
    }),
    output: WorkflowVersionInfo,
    error: S.Unknown,
  }),
  applyWorkflowTrafficRouting: activityDef({
    name: 'applyWorkflowTrafficRouting',
    input: S.Struct({
      environment: S.optional(FeatureFlagEnvironment),
      workflowFlagName: S.String,
      percent: S.String,
    }),
    output: S.Struct({ flagName: S.String }),
    error: S.Unknown,
  }),
  getRunningWorkflowIds: activityDef({
    name: 'getRunningWorkflowIds',
    input: S.Struct({
      workflowName: S.optional(S.String),
      taskQueue: S.String,
    }),
    output: S.Array(
      // workflowId
      S.String
    ),
    error: S.Unknown,
  }),
  getRunningWorkflowIdsCount: activityDef({
    name: 'getRunningWorkflowIdsCount',
    input: S.Struct({
      workflowName: S.optional(S.String),
      taskQueue: S.String,
    }),
    output: S.Number,
    error: S.Unknown,
  }),
  signalMigration: activityDef({
    name: 'signalMigration',
    input: S.Struct({
      workflowId: S.String,
      taskQueue: S.String,
    }),
    output: S.Unknown,
    error: S.Unknown,
  }),
  signalMigrationBatch: activityDef({
    name: 'signalMigrationBatch',
    input: S.Struct({
      workflowIds: S.Array(S.String),
      taskQueue: S.String,
    }),
    output: SignalMigrationBatchOutput,
    error: S.Unknown,
  }),
  getWorkflowDeployments: activityDef({
    name: 'getWorkflowDeployments',
    input: S.Struct({
      workflowName: S.String,
      versionId: S.String,
    }),
    output: S.Array(
      // todo. k8s deployment effect schema
      S.Unknown
    ),
    error: S.Union(NoDeploymentsFound, S.Any),
  }),
  deleteKubernetesDeployment: activityDef({
    name: 'deleteKubernetesDeployment',
    input: S.extend(
      S.Struct({ name: S.String, namespace: S.String }),
      KubectlOpts.pipe(S.omit('name', 'namespace'))
    ),
    output: S.String,
    error: S.Any,
  }),
  findKubernetesDeployments: activityDef({
    name: 'findKubernetesDeployments',
    input: KubectlOpts,
    output: S.Array(K8SDeployment),
    error: S.Unknown,
  }),
  deleteWorkflowVersionFlag: activityDef({
    name: 'deleteWorkflowVersionFlag',
    input: S.Struct({
      environment: S.optional(FeatureFlagEnvironment),
      workflowName: S.String,
      versionId: S.String,
    }),
    output: S.Unknown,
    error: S.Unknown,
  }),
  getFlagStrategies: activityDef({
    name: 'getFlagStrategies',
    input: S.Struct({
      flagName: S.String,
      environment: S.optional(FeatureFlagEnvironment),
      projectId: S.optional(S.String),
    }),
    output: S.Array(FlagStrategy),
    error: S.Unknown,
  }),
}

const RolloutWorkflowInput = S.Struct({
  workflowName: S.String,
  toVersion: WorkflowVersionInfo,
  initialRolloutPercent: S.optional(S.Number),
  stepPercent: S.optional(S.Number),
  stepIntervalSeconds: S.optional(S.Number),
  maxRolloutPercent: S.optional(S.Number),
})

const rollout = workflowDef({
  name: 'rollout',
  description: 'Increases general traffic to version',
  input: RolloutWorkflowInput,
  'temporal.workflow': {
    defaultTemporalOptions: {
      parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
    },
    signals: {},
    activities: {
      applyWorkflowTrafficRouting:
        activityDefinitions.applyWorkflowTrafficRouting,
      getFlagStrategies: activityDefinitions.getFlagStrategies,
    },
    childWorkflows: {},
  },
  output: S.Unknown,
  error: S.Unknown,
})

const migration = workflowDef({
  name: 'migration',
  description: '',
  input: S.Struct({
    workflowName: S.String,
    fromTaskQueue: S.String,
    toTaskQueue: S.String,
  }),
  'temporal.workflow': {
    signals: {},
    childWorkflows: {},
    activities: {
      getWorkflowIdsToMigrateToTaskQueueByFeatureFlag:
        activityDefinitions.getWorkflowIdsToMigrateToTaskQueueByFeatureFlag,
      getRunningWorkflowIds: activityDefinitions.getRunningWorkflowIds,
      signalMigration: activityDefinitions.signalMigration,
      signalMigrationBatch: activityDefinitions.signalMigrationBatch,
      getWorkflowDeployments: activityDefinitions.getWorkflowDeployments,
      deleteKubernetesDeployment:
        activityDefinitions.deleteKubernetesDeployment,
      deleteWorkflowVersionFlag: activityDefinitions.deleteWorkflowVersionFlag,
    },
    defaultTemporalOptions: {
      parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
    },
  },
  output: S.Unknown,
  error: S.Unknown,
})

const cleanup = workflowDef({
  name: 'cleanup',
  description: '',
  input: S.Struct({
    versionInfo: WorkflowVersionInfo,
  }),
  'temporal.workflow': {
    signals: {},
    childWorkflows: {},
    activities: {
      getRunningWorkflowIdsCount:
        activityDefinitions.getRunningWorkflowIdsCount,
      getWorkflowDeployments: activityDefinitions.getWorkflowDeployments,
      deleteKubernetesDeployment:
        activityDefinitions.deleteKubernetesDeployment,
      deleteWorkflowVersionFlag: activityDefinitions.deleteWorkflowVersionFlag,
    },
    defaultTemporalOptions: {
      parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
    },
  },
  output: S.Unknown,
  error: S.Unknown,
})

const workflowCI = workflowDef({
  name: 'workflowCI',
  description: '',
  input: S.Unknown,
  'temporal.workflow': {
    signals: {
      'diachronic.ci.workflow.deploy.success': WorkflowDeploymentSuccessEvent,
      'diachronic.ci.workflow.rollout.start': StartRolloutSignal,
      'diachronic.ci.workflow.rollout.cancel': CancelRolloutSignal,
      'diachronic.ci.workflow.migration.start': StartMigrationSignal,
    },
    activities: {
      applyWorkflowTrafficRouting:
        activityDefinitions.applyWorkflowTrafficRouting,
      getAllWorkflowVersionFlags:
        activityDefinitions.getAllWorkflowVersionFlags,
      applyWorkflowVersionFlag: activityDefinitions.applyWorkflowVersionFlag,
      startWorkflowSimulation: activityDefinitions.startWorkflowSimulation,
    },
    childWorkflows: {
      migration,
      rollout,
      cleanup,
    },
  },
  output: S.Unknown,
  error: S.Unknown,
})

export const workflowDefinitions = {
  workflowCI,
  migration,
  rollout,
  cleanup,
}
