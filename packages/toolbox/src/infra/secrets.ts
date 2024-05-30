import { Effect } from 'effect'
import { Environment } from './environment'
// import { Secret } from '@ei-tech/k8s-core/v1/Secret'
type Secret = any

export type ExternalSecret = {
  apiVersion: 'external-secrets.io/v1beta1'
  kind: 'ExternalSecret'
  metadata: {
    name: string
    namespace: string
  }
  spec: {
    refreshInterval: string
    secretStoreRef: {
      name: string
      kind: string
    }
    target: {
      // The Kubernetes secret name that will be created
      name: string
    }
    data: Array<{
      // The key that will be used in the Kubernetes secret
      secretKey: string
      remoteRef: {
        // Google Secret Manager Secret Name
        key: string
        // JSON property within the secret (optional)
        property?: string | undefined
      }
    }>
  }
}

/**
 * Returns a secret
 * @param args
 */
export const secret = (args: {
  // The Kubernetes secret name that will be created
  name: string
  // The Kubernetes namespace the secret will be created in
  namespace: string
  localClusterOnlyKeyValuesPreBase64?: Record<string, string>
  mappings: Array<{
    googleSecretManagerSecretName: string
    googleSecretManagerJSONKey?: string
    kubernetesSecretKey: string
  }>
}) =>
  Effect.flatMap(Environment, (a) =>
    Effect.if(a === 'local', {
      onTrue: () =>
        Effect.succeed({
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: {
            name: args.name,
            namespace: args.namespace,
          },
          data: Object.entries(
            args.localClusterOnlyKeyValuesPreBase64 || {}
          ).reduce(
            (a, [k, v]) => ({
              ...a,
              [k]: Buffer.from(v).toString('base64'),
            }),
            {}
          ),
        } as Secret),
      onFalse: () =>
        Effect.succeed({
          apiVersion: 'external-secrets.io/v1beta1' as const,
          kind: 'ExternalSecret' as const,
          metadata: {
            name: args.name,
            namespace: args.namespace,
          },
          spec: {
            refreshInterval: '1h',
            secretStoreRef: {
              name: 'gcp-backend',
              kind: 'ClusterSecretStore',
            },
            target: { name: args.name },
            data: args.mappings.map((x) => ({
              secretKey: x.kubernetesSecretKey,
              remoteRef: {
                key: x.googleSecretManagerSecretName,
                property: x.googleSecretManagerJSONKey,
              },
            })),
          },
        }),
    })
  )
