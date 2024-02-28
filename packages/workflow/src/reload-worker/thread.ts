import { pipe } from 'effect/Function'
import * as Effect from 'effect/Effect'
import { createWorker, WorkerWrapper } from '../worker'
import * as S from '@effect/schema/Schema'
import { ReloadWorkerConfig } from './config'

const env = S.decodeUnknownSync(ReloadWorkerConfig)(process.env, {
  errors: 'all',
})

export const startWorker = (paths: {
  workflowsPath: string
  activitiesPath: string
}) =>
  pipe(
    Effect.tryPromise(() =>
      createWorker({
        namespace: env.TEMPORAL_NAMESPACE,
        taskQueue: env.TEMPORAL_TASK_QUEUE,
        connection: { address: env.TEMPORAL_ADDRESS },
        activities: {
          type: 'compiled:filepath',
          path: paths.activitiesPath,
        },
        workflows: {
          type: 'compiled:filepath',
          path: paths.workflowsPath,
        },
        logLevel: 'Info',
        k8sHTTPHealthCheckDisabled: true,
        workerOptions: { reuseV8Context: true },
      })
    ),
    Effect.flatMap((w) =>
      Effect.sync(() => {
        w.start()
        // worker = w
        return w as WorkerWrapper
      })
    )
  )

export const main = () =>
  new Promise((resolve, reject) => {
    process.once('message', (paths: string) => {
      pipe(startWorker(JSON.parse(paths)), Effect.runPromise)
        .then(resolve)
        .catch(reject)
    })
  })
