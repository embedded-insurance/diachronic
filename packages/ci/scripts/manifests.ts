import * as R from 'ramda'
import { Effect, pipe } from 'effect'
import { defaultGCPSASetup } from '@diachronic/toolbox/infra/sa'
import { getWorkflowManifests } from '@diachronic/toolbox/infra/workflow-deployment'
import { GCPProviderFromEnv } from '@diachronic/toolbox/infra/gcp-provider'
import { secret } from '@diachronic/toolbox/infra/secrets'
import { kebabCase } from '@diachronic/toolbox/infra/string'
import { GetManifestsFunction } from '@diachronic/toolbox/infra/pipeline'
import { KubernetesManifest } from '@diachronic/toolbox/infra/manifests'

// import { ClusterRole } from '@ei-tech/k8s-api/v1/ClusterRole'
// import { ClusterRoleBinding } from '@ei-tech/k8s-api/v1/ClusterRoleBinding'
type ClusterRole = any
type ClusterRoleBinding = any

const featureFlagAdminAPISecret = (args: { namespace: string }) =>
  secret({
    name: 'feature-flag-admin-api-secrets',
    namespace: args.namespace,
    mappings: [
      {
        googleSecretManagerSecretName: 'feature_flag_admin_api_key',
        kubernetesSecretKey: 'FEATURE_FLAG_ADMIN_API_KEY',
      },
    ],
  })

/**
 * Spwans managed gke collectors for any resource with the label `diachronic/workflow-name`
 */
export const clusterTemporalWorkerMonitoring = () => ({
  apiVersion: 'monitoring.googleapis.com/v1',
  kind: 'ClusterPodMonitoring',
  metadata: {
    name: 'workflow-metrics-collector',
  },
  spec: {
    endpoints: [
      {
        interval: '30s',
        port: 'metrics',
      },
    ],
    selector: {
      matchExpressions: [
        {
          key: 'diachronic/workflow-name',
          operator: 'Exists',
        },
      ],
    },
  },
})

const featureFlagClientAPISecret = (args: { namespace: string }) =>
  secret({
    name: 'feature-flag-client-api-secrets',
    namespace: args.namespace,
    mappings: [
      {
        googleSecretManagerSecretName: 'feature_flag_workflow_ci_api_key',
        kubernetesSecretKey: 'FEATURE_FLAG_CLIENT_API_KEY',
      },
    ],
  })

/**
 * Provides Kubernetes API access for the workflow-ci app
 * @param args
 */
const k8sAPIAccess = (args: { name: string; namespace: string }) => {
  const role = {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'ClusterRole',
    metadata: {
      name: args.name,
      namespace: args.namespace,
    },
    // Workflow could have finer grained access with a CRD for workflow deployment, which
    // we have in workflow as a service but are not using at the moment
    // Finer-grained access based on e.g. a label selector is not available in the current K8s API
    // https://github.com/kubernetes/kubernetes/issues/44703
    rules: [
      {
        apiGroups: ['apps'],
        resources: ['pods', 'deployments'],
        verbs: ['get', 'list', 'watch', 'delete'],
      },
    ],
  } satisfies ClusterRole
  return [
    role,
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRoleBinding',
      metadata: { name: args.name, namespace: args.namespace },
      roleRef: {
        name: role.metadata.name,
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'ClusterRole',
      },
      subjects: [
        {
          kind: 'ServiceAccount',
          name: args.name,
          namespace: args.namespace,
        },
      ],
    } satisfies ClusterRoleBinding,
  ]
}

export const getManifests: GetManifestsFunction = (args) => {
  const name = args.name
  const namespace = args.namespace

  return pipe(
    Effect.Do,
    Effect.let('namespaceManifest', () => ({
      kind: 'Namespace',
      apiVersion: 'v1',
      metadata: { name: namespace },
    })),
    Effect.bind('sa', ({ namespaceManifest }) =>
      defaultGCPSASetup({
        name: kebabCase(name),
        namespace: namespaceManifest.metadata.name,
        description: `Service account for the ${name} deployment.`,
        roles: [],
      })
    ),
    Effect.bind('rbac', ({ sa }) =>
      Effect.succeed(
        k8sAPIAccess({
          name: sa.k8sSA.metadata.name,
          namespace: sa.k8sSA.metadata.namespace,
        })
      )
    ),
    Effect.bind('secrets', () =>
      Effect.all([
        featureFlagAdminAPISecret({ namespace }),
        featureFlagClientAPISecret({ namespace }),
      ] as const)
    ),
    Effect.bind('workflows', ({ secrets }) =>
      getWorkflowManifests(
        [
          {
            name,
            versionId: args.versionId,
            dockerImageIdent: args.dockerImageIdent,
          },
        ],
        {
          secrets,
          envVars: {
            FEATURE_FLAG_SERVER_URL:
              'http://unleash.unleash.svc.cluster.local:4242',
            SIGNALER_BASE_URL:
              'http://workflow-signaler.workflow-signaler.svc.cluster.local',
          },
        }
      )
    ),
    Effect.bind('monitoring', () =>
      Effect.succeed([clusterTemporalWorkerMonitoring()])
    ),
    Effect.map(
      ({ namespaceManifest, sa, secrets, workflows, rbac, monitoring }) =>
        [
          namespaceManifest,
          ...sa.flat,
          ...secrets,
          ...workflows,
          ...rbac,
          ...monitoring,
        ].map((x) =>
          R.assocPath(
            ['metadata', 'namespace'],
            namespaceManifest.metadata.name,
            x
          )
        ) as KubernetesManifest[]
    ),
    Effect.provide(GCPProviderFromEnv)
  )
}
