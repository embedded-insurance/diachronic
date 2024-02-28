import { Effect } from 'effect'
import { GCPProviderConfig } from './sa'
// import type { ServiceAccount as GCPServiceAccount } from '@ei-tech/gcp-cloudplatform/v1beta1/ServiceAccount'
// import { Bucket } from '@ei-tech/gcp-storage/v1beta1/Bucket'
// TODO. oss type defs
type GCPServiceAccount = any
type Bucket = any

export const bucket = (args: {
  gcpSA: GCPServiceAccount
  bucketName: string
  bucketLocation: string
}) =>
  Effect.map(
    GCPProviderConfig,
    (config) =>
      ({
        apiVersion: 'storage.gcp.upbound.io/v1beta1',
        kind: 'Bucket',
        metadata: {
          name: args.bucketName,
          namespace: args.gcpSA.metadata!.namespace!,
        },
        spec: {
          providerConfigRef: {
            name: config.metadata!.name!,
          },
          deletionPolicy: 'Orphan',
          forProvider: {
            project: config.spec.projectID,
            location: args.bucketLocation || 'us-central1',
            uniformBucketLevelAccess: true,
            autoclass: [{ enabled: true }],
          },
        },
      } satisfies Bucket)
  )
