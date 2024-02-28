import { Context, Effect, pipe } from 'effect'
// todo. aggregate into one package, support auto-import
// import type { ServiceAccountIAMMember } from '@ei-tech/gcp-cloudplatform/v1beta1/ServiceAccountIAMMember'
// import type { ServiceAccount as GCPServiceAccount } from '@ei-tech/gcp-cloudplatform/v1beta1/ServiceAccount'
// import type { ServiceAccount as K8sServiceAccount } from '@ei-tech/k8s-core/v1/ServiceAccount'
// import type { ProjectIAMMember } from '@ei-tech/gcp-cloudplatform/v1beta1/ProjectIAMMember'
// import type { ProviderConfig } from '@ei-tech/gcp-provider/v1beta1/ProviderConfig'
// import type { BucketIAMMember } from '@ei-tech/gcp-storage/v1beta1/BucketIAMMember'
// todo. open source type definitions
type ServiceAccountIAMMember = any
type GCPServiceAccount = any
type K8sServiceAccount = any
type ProjectIAMMember = any
type ProviderConfig = any
type BucketIAMMember = any

import * as R from 'ramda'

/**
 * Returns the GCP service account id string for a given project and name
 * @param args
 * @constructor
 */
export const gcpServiceAccountId = (args: {
  projectId: string
  name: string
}) =>
  `projects/${args.projectId}/serviceAccounts/${args.name}@${args.projectId}.iam.gserviceaccount.com`

export type GCPProviderConfig = ProviderConfig & {
  metadata: { name: string; namespace: string }
}

/**
 * Set of valid iam roles
 * there are many more we don't use often available elsewhere
 */
export type GCPIAMRole =
  | 'roles/secretmanager.secretAccessor'
  | 'roles/iam.workloadIdentityUser'
  | 'roles/iam.serviceAccountUser'
  | 'roles/iam.serviceAccountTokenCreator'

const sanitizeRoleName = (role: GCPIAMRole) =>
  role.toLowerCase().replace(/[\/.]/g, '-')

export const GCPProviderConfig =
  Context.Tag<GCPProviderConfig>('GCPProviderConfig')

/**
 * Constructs a GCP service account
 *
 * @example
 * ```yaml
 * apiVersion: cloudplatform.gcp.upbound.io/v1beta1
 * kind: ServiceAccount
 * metadata:
 *   name: gcp-some-workflow-sa
 *   namespace: some-workflow-v1
 * spec:
 *   forProvider:
 *     displayName: gcp-some-workflow-sa
 *     description: Service account for the some-workflow deployment
 *   providerConfigRef:
 *     name: gcp-provider-config
 * ```
 * @param name
 * @param namespace
 * @param description
 */
export const makeGCPSA = ({
  name,
  namespace,
  description,
}: {
  name: string
  namespace?: string
  description?: string
}) =>
  Effect.map(
    GCPProviderConfig,
    (config) =>
      ({
        apiVersion: 'cloudplatform.gcp.upbound.io/v1beta1',
        kind: 'ServiceAccount',
        metadata: {
          name: `gcp-${name}-sa`,
          namespace: namespace!,
        },
        spec: {
          forProvider: {
            displayName: name!,
            description: description!,
          },
          providerConfigRef: {
            name: config.metadata.name,
          },
        },
      } satisfies GCPServiceAccount)
  )

/**
 * TODO. verify we must duplicate ServiceAccountIAMMember + ProjectIAMMember
 * for each permission. I was under the impression workload identity allowed us
 * to use one or the other for all of them in all cases once the workloadIdentity permission is granted to the SA
 * @param gcpSA
 * @param k8sSA
 * @param roles
 */
export const gcpSAServiceAccountRoleBindings = (
  gcpSA: GCPServiceAccount,
  k8sSA: K8sServiceAccount,
  roles: GCPIAMRole[]
): Effect.Effect<GCPProviderConfig, unknown, ServiceAccountIAMMember[]> =>
  Effect.map(
    GCPProviderConfig,
    ({
      metadata: { name: providerConfigName },
      spec: { projectID: projectId },
    }) =>
      roles.map(
        (role) =>
          ({
            apiVersion: 'cloudplatform.gcp.upbound.io/v1beta1',
            kind: 'ServiceAccountIAMMember',
            metadata: {
              name: `${
                gcpSA.metadata!.name
              }-svcacct-iam-member-${sanitizeRoleName(role)}`,
              namespace: gcpSA.metadata!.namespace!,
            },
            spec: {
              providerConfigRef: {
                name: providerConfigName,
              },
              forProvider: {
                serviceAccountId: gcpServiceAccountId({
                  projectId,
                  name: gcpSA.metadata!.name!,
                }),
                member: `serviceAccount:${projectId}.svc.id.goog[${
                  k8sSA.metadata!.namespace
                }/${k8sSA.metadata!.name}]`,
                role,
              },
            },
          } satisfies ServiceAccountIAMMember)
      )
  )

/**
 * Constructs a set of IAM bindings for a GCP service account
 * @param gcpSA
 * @param roles
 */
export const gcpSAProjectRoleBindings = (
  gcpSA: GCPServiceAccount,
  roles: GCPIAMRole[]
): Effect.Effect<GCPProviderConfig, unknown, ProjectIAMMember[]> =>
  Effect.map(GCPProviderConfig, (config) =>
    roles.map((role) => ({
      apiVersion: 'cloudplatform.gcp.upbound.io/v1beta1',
      kind: 'ProjectIAMMember',
      metadata: {
        name: `${gcpSA.metadata!.name}-${role
          .toLowerCase()
          .replace(/[\/.]/g, '-')}`,
        namespace: gcpSA.metadata!.namespace!,
      },
      spec: {
        forProvider: {
          project: config.spec.projectID,
          member: `serviceAccount:${gcpSA.metadata!.name}@${
            config.spec.projectID
          }.iam.gserviceaccount.com`,
          role: role,
        },
        providerConfigRef: {
          name: config.metadata!.name!,
        },
      },
    }))
  )

export const k8sSA = (args: { name: string; namespace: string }) =>
  ({
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: {
      name: args.name,
      namespace: args.namespace,
    },
  } satisfies K8sServiceAccount)

/**
 * Derives a k8s service account from a GCP service account
 * @param gcpSA
 */
export const k8sSAFromGCPSA = (gcpSA: GCPServiceAccount) =>
  Effect.map(
    GCPProviderConfig,
    (config) =>
      ({
        apiVersion: 'v1',
        kind: 'ServiceAccount',
        metadata: {
          name: gcpSA.metadata!.name!.startsWith('gcp-')
            ? gcpSA.metadata!.name!.slice(4)
            : gcpSA.metadata!.name!,
          namespace: gcpSA.metadata!.namespace!,
          annotations: {
            'iam.gke.io/gcp-service-account': `${gcpSA.metadata!.name}@${
              config.spec.projectID
            }.iam.gserviceaccount.com`,
          },
        },
      } satisfies K8sServiceAccount)
  )

/**
 * Establishes the workload identity relationship between a GCP service account and a k8s service account
 * @param gcpSA
 * @param k8sSA
 */
export const ksaGSABinding = (
  gcpSA: GCPServiceAccount,
  k8sSA: K8sServiceAccount
) =>
  Effect.map(
    GCPProviderConfig,
    ({
      metadata: { name: providerConfigName },
      spec: { projectID: projectId },
    }) =>
      ({
        apiVersion: 'cloudplatform.gcp.upbound.io/v1beta1',
        kind: 'ServiceAccountIAMMember',
        metadata: {
          name: `${gcpSA.metadata!.name}-iam-member-workloadidentityuser`,
          // punting on which to use here. hopefully it doesn't matter
          namespace: k8sSA.metadata!.namespace!,
        },
        spec: {
          providerConfigRef: {
            name: providerConfigName,
          },
          forProvider: {
            serviceAccountId: gcpServiceAccountId({
              projectId,
              name: gcpSA.metadata!.name!,
            }),
            member: `serviceAccount:${projectId}.svc.id.goog[${
              k8sSA.metadata!.namespace
            }/${k8sSA.metadata!.name}]`,
            role: 'roles/iam.workloadIdentityUser',
          },
        },
      } satisfies ServiceAccountIAMMember)
  )

/**
 * Returns the yaml required for most workloads to access to cloud resources
 * @param args
 */
export const defaultGCPSASetup = (args: {
  name: string
  namespace: string
  description?: string
  roles: GCPIAMRole[]
}) =>
  pipe(
    Effect.Do,
    Effect.bind('gcpSA', () =>
      makeGCPSA({
        name: args.name,
        namespace: args.namespace,
        description: args.description!,
      })
    ),
    Effect.bind('k8sSA', ({ gcpSA }) => k8sSAFromGCPSA(gcpSA)),
    Effect.bind('permissions', ({ gcpSA, k8sSA }) =>
      pipe(
        Effect.all([
          gcpSAProjectRoleBindings(
            gcpSA,
            R.uniq([...args.roles, 'roles/iam.workloadIdentityUser'])
          ),
          gcpSAServiceAccountRoleBindings(
            gcpSA,
            k8sSA,
            R.uniq([...args.roles, 'roles/iam.workloadIdentityUser'])
          ),
        ] as const),
        Effect.map((x) => [...x[0], ...x[1]])
      )
    ),
    Effect.let('flat', ({ gcpSA, k8sSA, permissions }) => [
      gcpSA,
      k8sSA,
      ...permissions,
    ])
  )
const gcpSANameToK8sSAName = (name: string) =>
  `${name.startsWith('gcp-') ? name.slice(4) : name}`

export type GCPBucketPermissions =
  | 'roles/storage.objectViewer'
  | 'roles/storage.objectCreator'
  | 'roles/storage.objectUser'

/**
 * Returns the yaml required for a GCP service account to access a bucket
 * @param args
 */
export const bucketPermissions = (args: {
  gcpSA: GCPServiceAccount
  bucketName: string
  roles: Array<GCPBucketPermissions>
}) =>
  Effect.map(GCPProviderConfig, (config) =>
    args.roles.map(
      (x) =>
        ({
          apiVersion: 'storage.gcp.upbound.io/v1beta1',
          kind: 'BucketIAMMember',
          metadata: {
            name: `${gcpSANameToK8sSAName(args.gcpSA.metadata!.name!)}-${
              args.bucketName
            }-${x.toLowerCase().replace(/[\/.]/g, '-')}`,
            namespace: args.gcpSA.metadata!.namespace!,
          },
          spec: {
            providerConfigRef: {
              name: config.metadata!.name!,
            },
            forProvider: {
              bucket: args.bucketName,
              member: `serviceAccount:${args.gcpSA.metadata!.name}@${
                config.spec.projectID
              }.iam.gserviceaccount.com`,
              role: x,
            },
          },
        } satisfies BucketIAMMember)
    )
  )
