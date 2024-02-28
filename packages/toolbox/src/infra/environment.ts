import * as S from '@effect/schema/Schema'
import { Context, Layer } from 'effect'

export const EnvironmentName = S.literal('development', 'production', 'local')
export type Environment = S.Schema.To<typeof EnvironmentName>
export const Environment = Context.Tag<Environment>(
  'diachronic.infra/Environment'
)
export const EnvironmentLayer = (a: Environment) =>
  Layer.succeed(Environment, Environment.of(a))

export const DiachronicCloudEnvironment = S.literal('development', 'production')
export type DiachronicCloudEnvironment = S.Schema.To<
  typeof DiachronicCloudEnvironment
>

/**
 * Gets Environment from process.env
 * Uses default when unset
 */
export const environmentFromEnv = (withDefault?: Environment) => {
  try {
    return S.decodeSync(EnvironmentName)(
      (process.env.DIACHRONIC_CLOUD_ENVIRONMENT || withDefault) as any
    )
  } catch (e) {
    console.log(
      'Invalid DIACHRONIC_CLOUD_ENVIRONMENT: ',
      process.env.DIACHRONIC_CLOUD_ENVIRONMENT
    )
    throw e
  }
}
