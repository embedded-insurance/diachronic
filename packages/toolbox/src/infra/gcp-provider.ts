import { Effect, Layer } from 'effect'
import { GCPProviderConfig } from './sa'
import { Environment } from './environment'

/**
 * Derives GCPProviderConfig for Environment.
 */
export const GCPProviderFromEnv = Layer.effect(
  GCPProviderConfig,
  Effect.map(Environment, (env) =>
    GCPProviderConfig.of({
      metadata: { name: 'gcp-provider-config' },
      spec: { projectID: `diachronic-${env}` },
    } as GCPProviderConfig)
  )
)
