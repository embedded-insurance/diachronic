import * as S from '@effect/schema/Schema'
import { Context, Layer } from 'effect'

export const EnvironmentName = S.Literal('development', 'production', 'local')
export type Environment = S.Schema.Type<typeof EnvironmentName>
export const Environment = Context.GenericTag<Environment>(
  'diachronic.infra/Environment'
)
export const EnvironmentLayer = (a: Environment) =>
  Layer.succeed(Environment, Environment.of(a))

export const DiachronicCloudEnvironment = S.Literal('development', 'production')
export type DiachronicCloudEnvironment = S.Schema.Type<
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
