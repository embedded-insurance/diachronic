// import { Deployment } from '@ei-tech/k8s-api/v1/Deployment'
type Deployment = any

export type KubernetesManifest = {
  apiVersion: string
  kind: string
  metadata: {
    name: string
    namespace?: string
    labels?: Record<string, string>
  }
}

export type Versioned<T extends KubernetesManifest> = T & {
  metadata: {
    labels: {
      'diachronic/version-id': string
    }
  }
}

/**
 * Returns true if the manifest is versioned
 * Presently, versioned resources are Temporal worker deployments
 * @param x
 */
export const isVersioned = <T extends KubernetesManifest>(
  x: T
): x is Versioned<T> =>
  x.metadata?.labels?.['diachronic/version-id'] !== undefined

export const isDeployment = <T extends KubernetesManifest>(
  x: T
): // @ts-ignore wrong
x is Deployment => x.apiVersion === 'apps/v1' && x.kind === 'Deployment'
