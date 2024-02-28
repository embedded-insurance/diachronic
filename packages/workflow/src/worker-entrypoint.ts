import * as S from '@effect/schema/Schema'
import { createWorker } from './worker'

const RequiredConfig = S.struct({
  TEMPORAL_ADDRESS: S.string,
  TEMPORAL_NAMESPACE: S.string,
  TEMPORAL_TASK_QUEUE: S.string,
})
const OptionalConfig = S.partial(
  S.struct({
    WORKFLOWS_PATH: S.string,
    ACTIVITIES_PATH: S.string,
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
