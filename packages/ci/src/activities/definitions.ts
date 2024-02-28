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
const K8SDeployment = S.unknown
const FlagStrategy = S.struct({
  id: S.string,
  name: S.string,
  title: S.string,
  disabled: S.boolean,
  parameters: S.optional(
    S.struct({
      rollout: S.string,
      stickiness: S.string,
      groupId: S.string,
    })
  ),
})

export const SignalMigrationBatchOutput = S.struct({
  successes: S.array(S.string),
  failures: S.array(S.string),
})
export const activityDefinitions = {
  ...simulationActivityDefinitions,
  getAllWorkflowVersionFlags: activityDef({
    name: 'getAllWorkflowVersionFlags',
    input: S.struct({
      environment: S.optional(FeatureFlagEnvironment),
      workflowName: S.string,
    }),
    output: S.array(WorkflowVersionInfo),
    error: S.unknown,
  }),
  getAllDeployedWorkflowVersions: activityDef({
    name: 'getAllDeployedWorkflowVersions',
    description:
      'Returns all deployed workflow versions, unique by their version id, using the diachronic/version-id Kubernetes label',
    input: S.struct({
      workflowName: S.string,
    }),
    output: S.array(S.string),
    error: S.unknown,
  }),
  getWorkflowIdsToMigrateToTaskQueueByFeatureFlag: activityDef({
    name: 'getWorkflowIdsToMigrateToTaskQueueByFeatureFlag',
    input: S.struct({
      workflowName: S.string,
      fromTaskQueue: S.string,
      toTaskQueue: S.string,
    }),
    output: S.struct({
      toMigrate: S.array(S.string),
      numberRemaining: S.number,
    }),
    error: S.unknown,
  }),
  applyWorkflowVersionFlag: activityDef({
    name: 'applyWorkflowVersionFlag',
    input: S.struct({
      environment: S.optional(FeatureFlagEnvironment),
      workflowName: S.string,
      versionId: S.string,
    }),
    output: WorkflowVersionInfo,
    error: S.unknown,
  }),
  applyWorkflowTrafficRouting: activityDef({
    name: 'applyWorkflowTrafficRouting',
    input: S.struct({
      environment: S.optional(FeatureFlagEnvironment),
      workflowFlagName: S.string,
      percent: S.string,
    }),
    output: S.struct({ flagName: S.string }),
    error: S.unknown,
  }),
  getRunningWorkflowIds: activityDef({
    name: 'getRunningWorkflowIds',
    input: S.struct({
      workflowName: S.optional(S.string),
      taskQueue: S.string,
    }),
    output: S.array(
      // workflowId
      S.string
    ),
    error: S.unknown,
  }),
  getRunningWorkflowIdsCount: activityDef({
    name: 'getRunningWorkflowIdsCount',
    input: S.struct({
      workflowName: S.optional(S.string),
      taskQueue: S.string,
    }),
    output: S.number,
    error: S.unknown,
  }),
  signalMigration: activityDef({
    name: 'signalMigration',
    input: S.struct({
      workflowId: S.string,
      taskQueue: S.string,
    }),
    output: S.unknown,
    error: S.unknown,
  }),
  signalMigrationBatch: activityDef({
    name: 'signalMigrationBatch',
    input: S.struct({
      workflowIds: S.array(S.string),
      taskQueue: S.string,
    }),
    output: SignalMigrationBatchOutput,
    error: S.unknown,
  }),
  getWorkflowDeployments: activityDef({
    name: 'getWorkflowDeployments',
    input: S.struct({
      workflowName: S.string,
      versionId: S.string,
    }),
    output: S.array(
      // todo. k8s deployment effect schema
      S.unknown
    ),
    error: S.union(NoDeploymentsFound, S.any),
  }),
  deleteKubernetesDeployment: activityDef({
    name: 'deleteKubernetesDeployment',
    input: S.extend(
      S.struct({ name: S.string, namespace: S.string }),
      KubectlOpts.pipe(S.omit('name', 'namespace'))
    ),
    output: S.string,
    error: S.any,
  }),
  findKubernetesDeployments: activityDef({
    name: 'findKubernetesDeployments',
    input: KubectlOpts,
    output: S.array(K8SDeployment),
    error: S.unknown,
  }),
  deleteWorkflowVersionFlag: activityDef({
    name: 'deleteWorkflowVersionFlag',
    input: S.struct({
      environment: S.optional(FeatureFlagEnvironment),
      workflowName: S.string,
      versionId: S.string,
    }),
    output: S.unknown,
    error: S.unknown,
  }),
  getFlagStrategies: activityDef({
    name: 'getFlagStrategies',
    input: S.struct({
      flagName: S.string,
      environment: S.optional(FeatureFlagEnvironment),
      projectId: S.optional(S.string),
    }),
    output: S.array(FlagStrategy),
    error: S.unknown,
  }),
}

const RolloutWorkflowInput = S.struct({
  workflowName: S.string,
  toVersion: WorkflowVersionInfo,
  initialRolloutPercent: S.optional(S.number),
  stepPercent: S.optional(S.number),
  stepIntervalSeconds: S.optional(S.number),
  maxRolloutPercent: S.optional(S.number),
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
  output: S.unknown,
  error: S.unknown,
})

const migration = workflowDef({
  name: 'migration',
  description: '',
  input: S.struct({
    workflowName: S.string,
    fromTaskQueue: S.string,
    toTaskQueue: S.string,
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
  output: S.unknown,
  error: S.unknown,
})

const cleanup = workflowDef({
  name: 'cleanup',
  description: '',
  input: S.struct({
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
  output: S.unknown,
  error: S.unknown,
})

const workflowCI = workflowDef({
  name: 'workflowCI',
  description: '',
  input: S.unknown,
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
  output: S.unknown,
  error: S.unknown,
})

export const workflowDefinitions = {
  workflowCI,
  migration,
  rollout,
  cleanup,
}
