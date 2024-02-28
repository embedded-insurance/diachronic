import cluster, { Worker as ClusterWorker } from 'cluster'
import * as Effect from 'effect/Effect'
import { Layer, Logger, LogLevel, Queue, Scope } from 'effect'
import { pipe } from 'effect/Function'
import * as S from '@effect/schema/Schema'
import {
  MQTTClient,
  MQTTLive,
} from '@diachronic/workflow-request-response/mqtt'
import { Fetch } from '@effect-use/http-client'
import * as K8SHealthCheckHTTP from '@diachronic/k8s-health-check'
import path from 'path'
import { randomUUID } from 'node:crypto'
import { downloadFileHTTP, removeDirectory, untar } from './util'
import { MessageType, Reload, reply } from './api'
import { ReloadWorkerConfig, SELF_DIR } from './config'

const env = S.decodeUnknownSync(ReloadWorkerConfig)(process.env, {
  errors: 'all',
})

let processes: Record<
  string,
  {
    id: number
    inner: ClusterWorker
    stop: () => void
    paths: { workflowsPath: string; activitiesPath: string }
  }
> = {}

const startChildProcess = (paths: {
  workflowsPath: string
  activitiesPath: string
}) =>
  Effect.try(() => {
    const child = cluster.fork()
    child.send(JSON.stringify(paths))
    processes[child.id] = {
      id: child.id,
      inner: child,
      stop: () => child.destroy('SIGINT'),
      paths,
    }
    return processes[child.id]
  })

const stopAllChildProcesses = () =>
  Effect.all(
    Object.values(processes).map((p) => Effect.try(() => p.stop()))
    // {
    //   mode: 'either',
    //   discard: true,
    // }
  )

const resetWorker = (paths: {
  workflowsPath: string
  activitiesPath: string
}) =>
  pipe(
    stopAllChildProcesses(),
    Effect.withLogSpan('stop-all-child-processes'),
    Effect.tap(() => startChildProcess(paths)),
    Effect.withLogSpan('start-worker')
  )

const processReload = (a: Reload) => {
  const rootdir = SELF_DIR
  const nextDir = path.join(
    rootdir,
    `${new Date()
      .toISOString()
      .replace(/:/g, '-')
      .replace(/\./g, '-')}-${randomUUID()}`
  )

  const prevDir = null
  // !worker
  //   ? null
  //   : path.dirname(
  //       (worker.worker.options.workflowBundle as any).codePath as string
  //     )

  const paths = {
    workflowsPath: path.join(nextDir, 'workflow.js'),
    activitiesPath: path.join(nextDir, 'activities.js'),
  }
  return pipe(
    downloadFileHTTP(a.payload.url, path.join(nextDir, 'bundle.tar.gz')),
    Effect.withLogSpan('download-code'),
    Effect.flatMap(() => untar(path.join(nextDir, 'bundle.tar.gz'), nextDir)),
    Effect.withLogSpan('extract-files'),
    Effect.flatMap(() => resetWorker(paths)),
    Effect.withLogSpan('reset-worker'),
    Effect.flatMap(() =>
      prevDir ? removeDirectory(prevDir) : Effect.succeed(Effect.unit)
    ),
    Effect.flatMap(() =>
      pipe(
        reply(a.payload.from, {
          type: 'reload',
          payload: {
            url: a.payload.url,
            timestamp: new Date().toISOString(),
          },
        }),
        Effect.withLogSpan('reply')
      )
    )
  )
}
let q = Effect.runSync(Queue.sliding<MessageType>(2 ** 4))
const receive = () => Queue.take(q)
const program = () =>
  pipe(
    receive(),
    Effect.tap((a) =>
      pipe(Effect.logDebug('Received message'), Effect.annotateLogs(a))
    ),
    Effect.flatMap(
      Effect.unifiedFn((a) => {
        switch (a.type) {
          case 'reload': {
            return processReload(a)
          }
          default:
            return Effect.unit
        }
      })
    ),
    Effect.tapErrorCause(Effect.logError),
    Effect.tapDefect(Effect.logError),
    Effect.withLogSpan('program'),
    Effect.catchAll(Effect.succeed),
    Effect.forever
  )

export const main = async () => {
  // The address of this "actor", where it can be communicated with.
  // Messages are polymorphic, not different per topic
  const address = env.DIACHRONIC_CI_MQTT_TOPIC

  const mqttLayer = MQTTLive({ brokerURL: env.DIACHRONIC_CI_MQTT_BROKER_URL })

  // process messages
  const ok = pipe(
    program(),
    Effect.provide(mqttLayer),
    Effect.provide(Layer.succeed(Fetch, fetch)),
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.runFork
  )

  let scope = Effect.runSync(Scope.make())

  // Receive messages over MQTT`
  pipe(
    Effect.asyncEffect<never, any, any, MQTTClient, any, any>((resume) =>
      Effect.flatMap(MQTTClient, (mqtt) => {
        const cb = (_address: string, message: MessageType) => {
          try {
            const data = JSON.parse(message.toString())
            q.unsafeOffer(data)
          } catch (e) {
            console.error(e)
          }
        }
        mqtt.on('message', cb as any)
        mqtt.subscribe(address)

        return Effect.unit
      })
    ),
    Effect.catchAll(Effect.succeed),
    Effect.provide(mqttLayer),
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.forkIn(scope),
    Effect.runPromise
  )

  K8SHealthCheckHTTP.run(
    {
      port: 8080,
      startupProbe: { path: '/startup' },
      livenessProbe: { path: '/liveness' },
      readinessProbe: { path: '/readiness' },
    },
    {
      isReady: async () => ({ ok: true }),
      isLive: async () => ({ ok: true }),
      isStarted: async () => ({ ok: true }),
    }
  )
    .then((x) => {
      // console.log('health check server started', x)
    })
    .catch((e) => {
      console.error('health check server failed ', e)
      throw e
    })

  return await Effect.runPromise(ok.await)
}
