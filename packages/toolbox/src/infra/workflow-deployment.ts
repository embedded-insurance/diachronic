import { Environment } from './environment'
import * as R from 'ramda'
import { Effect } from 'effect'
import * as StringUtils from './string'
import { workflowTaskQueueName } from './versioning'
import { gkeSpotInstanceTolerations } from './tolerations'
import { ExternalSecret } from './secrets'
// import { NodeSelectorRequirement } from '@ei-tech/k8s-core/v1/NodeSelectorRequirement'
// import { PreferredSchedulingTerm } from '@ei-tech/k8s-core/v1/PreferredSchedulingTerm'
// import { Secret } from '@ei-tech/k8s-core/v1/Secret'
// import { Deployment } from '@ei-tech/k8s-api/v1/Deployment'
// import { ContainerPort } from '@ei-tech/k8s-core/v1/ContainerPort'
type NodeSelectorRequirement = any
type PreferredSchedulingTerm = any
type Secret = any
type Deployment = any
type ContainerPort = any

export type WorkflowVersionInfo = {
  name: string
  versionId: string
  // in the future the design won't require a dockerimageident that diverges from versionId
  // for now it's required since it may vary depending on build mode (interactive requires version id to be stable
  // but docker image tags are immutable)
  dockerImageIdent: string
  // Overrides the taskQueue for this workflow version that would have been
  // calculated from its versionId, environment, and name
  taskQueue?: string
}

const defaultWorkflowDeploymentEnvVars = (args: {
  taskQueue: string
  environment: Environment
}) =>
  ({
    TEMPORAL_ADDRESS: 'temporal-frontend.temporal.svc.cluster.local',
    TEMPORAL_NAMESPACE: args.environment,
    TEMPORAL_TASK_QUEUE: args.taskQueue,
    WORKFLOWS_PATH: '/code/dist/workflow.js',
    // would be good to know there are no activities so we can omit this
    ACTIVITIES_PATH: '/code/dist/activities.js',
  } as const)

export const workflowDeployment = <
  const Name extends string,
  const VersionId extends string,
  const Env extends Environment
>(args: {
  workflowName: Name
  versionId: VersionId
  environment: Env
  dockerImageIdent: string
  envVars?: Record<string, any> | undefined
  secrets?: Array<ExternalSecret | Secret> | undefined
  noServiceAccount?: true | undefined
  overrides?: {
    taskQueue: string
  }
}) => {
  if (args.overrides?.taskQueue) {
    console.warn(
      'Workflow task queue will be overwritten. This may cause issues with signal routing in deployed environments that use versioning.'
    )
  }
  const taskQueue =
    args.overrides?.taskQueue ||
    workflowTaskQueueName({
      versionId: args.versionId,
      workflowName: args.workflowName,
    })
  const image = args.dockerImageIdent
  const workflowNameKebab = StringUtils.kebabCase(args.workflowName)
  const deploymentName = `${workflowNameKebab}-${args.versionId}-deployment`
  const workflowNameVersioned = `${workflowNameKebab}-${args.versionId}`

  const envVars = Object.entries(
    R.mergeDeepRight(
      defaultWorkflowDeploymentEnvVars({ ...args, taskQueue }),
      args.envVars || {}
    )
  ).map(([k, v]) => ({
    name: k,
    value: v,
  }))
  const serviceAccountName = args.noServiceAccount
    ? undefined
    : workflowNameKebab + '-sa'
  const labels = {
    app: workflowNameVersioned + '-worker',
    'diachronic/workflow-name': args.workflowName,
    'diachronic/version-id': args.versionId,
    // 'app.kubernetes.io/name': workflowName + '-worker',
    // 'app.kubernetes.io/instance': workflowName + '-' + args.versionId + '-worker',
    // 'app.kubernetes.io/version': args.versionId,
    // 'app.kubernetes.io/component': 'temporal-worker',
    // 'app.kubernetes.io/part-of': workflowName + '-workflow',
    // 'app.kubernetes.io/managed-by': 'diachronic',
  }
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: deploymentName,
      labels,
    },
    spec: {
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          serviceAccountName,
          affinity: {
            nodeAffinity: {
              preferredDuringSchedulingIgnoredDuringExecution: [
                {
                  weight: 1,
                  preference: {
                    matchExpressions: [
                      {
                        key: 'cloud.google.com/gke-spot',
                        operator: 'In',
                        values: ['true'] as string[],
                      },
                    ] as NodeSelectorRequirement[],
                  },
                },
              ] as PreferredSchedulingTerm[],
            },
          },
          tolerations: [...gkeSpotInstanceTolerations],
          containers: [
            {
              name: workflowNameKebab + '-worker',
              image: image,
              resources: {
                requests: {
                  cpu: '1000m',
                  memory: '2000Mi',
                },
                limits: {
                  cpu: '1250m',
                  memory: '2500Mi',
                },
              },
              ports: [
                {
                  containerPort: 9090,
                  name: 'metrics',
                },
                {
                  containerPort: 8080,
                  name: 'health',
                },
              ] as Array<ContainerPort>,
              env: envVars,
              envFrom: (args.secrets || []).map((x) => ({
                secretRef: { name: x.metadata!.name! },
              })),
              startupProbe: {
                httpGet: {
                  path: '/startup',
                  port: 'health',
                  scheme: 'HTTP',
                },
                initialDelaySeconds: 5,
                periodSeconds: 10,
                successThreshold: 1,
                failureThreshold: 30,
              },
            },
          ],
        },
      },
    },
  } as const satisfies Deployment
}

export type GCPPodMonitoring = {
  apiVersion: 'monitoring.googleapis.com/v1'
  kind: 'PodMonitoring'
  metadata: {
    name: string
  }
  spec: {
    endpoints: [
      {
        interval: string
        port: string
      }
    ]
    selector: {
      matchLabels: {
        app: string
      }
    }
  }
}

export type GCPClusterPodMonitoring = {
  apiVersion: 'monitoring.googleapis.com/v1'
  kind: 'ClusterPodMonitoring'
  metadata: {
    name: string
  }
  spec: {
    endpoints: [
      {
        interval: string
        port: string
      }
    ]
    selector: {
      matchLabels: {
        app: string
      }
    }
  }
}

export const workflowMetricsCollector = <const Name extends string>(args: {
  workflowName: Name
}) => {
  const name = StringUtils.kebabCase(args.workflowName)
  return {
    apiVersion: 'monitoring.googleapis.com/v1',
    kind: 'PodMonitoring',
    metadata: {
      name: `${name}-temporal-metrics-collector`,
    },
    spec: {
      endpoints: [
        {
          interval: '30s',
          port: 'metrics',
        },
      ],
      selector: {
        matchLabels: {
          app: name,
        },
      },
    },
  } satisfies GCPPodMonitoring
}

export const getWorkflowManifests = (
  args: WorkflowVersionInfo[],
  overrides?: {
    secrets?: Array<ExternalSecret | Secret>
    envVars?: Record<string, any>
    noServiceAccount?: true
  }
) =>
  Effect.map(Environment, (environment) => {
    const deployments = args.flatMap((workflow) => [
      workflowDeployment({
        workflowName: workflow.name,
        versionId: workflow.versionId,
        dockerImageIdent: workflow.dockerImageIdent,
        environment,
        envVars: overrides?.envVars,
        secrets: overrides?.secrets,
        noServiceAccount: overrides?.noServiceAccount,
      }),
    ])
    return deployments as Array<Deployment>
  })
