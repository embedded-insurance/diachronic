import * as S from '@effect/schema/Schema'
import { createWorker } from './worker'

const RequiredConfig = S.Struct({
  TEMPORAL_ADDRESS: S.String,
  TEMPORAL_NAMESPACE: S.String,
  TEMPORAL_TASK_QUEUE: S.String,
})
const OptionalConfig = S.partial(
  S.Struct({
    WORKFLOWS_PATH: S.String,
    ACTIVITIES_PATH: S.String,
  })
)
const Config = S.extend(RequiredConfig, OptionalConfig)

const env = S.decodeUnknownSync(Config)(process.env, { errors: 'all' })

createWorker({
  namespace: env.TEMPORAL_NAMESPACE,
  taskQueue: env.TEMPORAL_TASK_QUEUE,
  connection: { address: env.TEMPORAL_ADDRESS },
  // @ts-expect-error
  activities: env.ACTIVITIES_PATH && {
    type: 'compiled:filepath',
    path: env.ACTIVITIES_PATH,
  },
  // FIXME. "exact" optional types is driving me nuts. This is supposed to be optional
  // @ts-expect-error
  workflows: env.WORKFLOWS_PATH && {
    type: 'compiled:filepath',
    path: env.WORKFLOWS_PATH,
  },
  logLevel: 'Info',
  workerOptions: {
    reuseV8Context: false,
  },
}).then((worker) => worker.start())
