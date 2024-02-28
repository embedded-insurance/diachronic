import * as S from '@effect/schema/Schema'

const RequiredConfig = S.extend(
  S.struct({
    TEMPORAL_ADDRESS: S.string,
    TEMPORAL_NAMESPACE: S.string,
    TEMPORAL_TASK_QUEUE: S.string,
    DIACHRONIC_CI_MQTT_BROKER_URL: S.string,
    DIACHRONIC_CI_MQTT_TOPIC: S.string,
  }),
  S.union(
    S.struct({
      WORKFLOWS_PATH: S.string,
    }),
    S.struct({
      ACTIVITIES_PATH: S.string,
    })
  )
)
export const ReloadWorkerConfig = RequiredConfig

export const SELF_DIR = '/waas'
