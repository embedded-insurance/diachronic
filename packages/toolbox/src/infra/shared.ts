import * as S from '@effect/schema/Schema'
import { EnvironmentName } from './environment'

// "a lowercase RFC 1123 subdomain must consist of lower case alphanumeric characters, '-' or '.', and must start and end with an alphanumeric character (e.g. 'example.com', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*')"
const rfc1123Subdomain = S.pattern(
  /[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*/
)
export const VERSION_ID = S.string.pipe(rfc1123Subdomain)
export const getEnv = () =>
  S.decodeSync(
    S.struct({
      VERSION_ID,
      DIACHRONIC_CLOUD_ENVIRONMENT: EnvironmentName,
    })
  )(process.env as any)

export type BuildDeployMode =
  // dev loop, rebuilds and deploys on change
  | 'interactive'
  // ci / immutable, runs and exits
  | 'once'
