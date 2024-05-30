import * as S from '@effect/schema/Schema'

const RequiredConfig = S.extend(
  S.Struct({
    TEMPORAL_ADDRESS: S.String,
    TEMPORAL_NAMESPACE: S.String,
    TEMPORAL_TASK_QUEUE: S.String,
    DIACHRONIC_CI_MQTT_BROKER_URL: S.String,
    DIACHRONIC_CI_MQTT_TOPIC: S.String,
  }),
  S.Union(
    S.Struct({
      WORKFLOWS_PATH: S.String,
    }),
    S.Struct({
      ACTIVITIES_PATH: S.String,
    })
  )
)
export const ReloadWorkerConfig = RequiredConfig

export const SELF_DIR = '/waas'
