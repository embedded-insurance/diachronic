import {
  Worker,
  NativeConnection,
  Runtime as TemporalWorkerRuntime,
  Logger as TemporalRuntimeLogger,
  LogMetadata,
  LogLevel as TemporalLogLevel,
  WorkflowBundleOption,
  IllegalStateError,
  WorkerOptions,
} from '@temporalio/worker'
import * as S from '@effect/schema/Schema'
import { pipe } from 'effect/Function'
import * as Effect from 'effect/Effect'
import { TemporalConfig } from '@effect-use/temporal-config'
import * as Data from 'effect/Data'
import * as LogLevel from 'effect/LogLevel'
import * as Runtime from 'effect/Runtime'
import * as Logger from 'effect/Logger'
import * as Layer from 'effect/Layer'
import { Trigger } from '@diachronic/util/trigger'
import * as Logging from '@effect-use/gcp-logging'
import {
  HealthCheckServer,
  HealthCheckServerConfig,
  run,
} from '@diachronic/k8s-health-check'
import { loggerSink } from './workflow-logging'

export const ActivityCode = S.Union(
  S.Struct({
    type: S.Literal('source:filepath'),
    path: S.String,
  }),
  S.Struct({
    type: S.Literal('source:object'),
    activities: S.Object,
  }),
  S.Struct({
    type: S.Literal('compiled:filepath'),
    path: S.String,
  })
)
export type ActivityCode = S.Schema.Type<typeof ActivityCode>

export const WorkflowCode = S.Union(
  S.Struct({
    type: S.Literal('source:filepath'),
    path: S.String,
  }),
  S.Struct({
    type: S.Literal('compiled:string'),
    code: S.String,
  }),
  S.Struct({
    type: S.Literal('compiled:filepath'),
    path: S.String,
  })
)
export type WorkflowCode = S.Schema.Type<typeof WorkflowCode>

export const resolveFilepathOrFail = (
  path: string
): Effect.Effect<string, FileNotFound> =>
  pipe(
    Effect.try(() => require.resolve(path)),
    Effect.mapError((e) =>
      FileNotFound({
        attemptedPath: path,
        error: e,
      })
    )
  )

export const resolveActivityCode = (
  code: ActivityCode
): Effect.Effect<{ activities: object }, unknown> => {
  switch (code.type) {
    case 'compiled:filepath':
    case 'source:filepath':
      return pipe(
        resolveFilepathOrFail(code.path),
        Effect.flatMap((path) =>
          Effect.tryPromise(async () => await require(path))
        ),
        Effect.map((activities) => ({ activities }))
      )
    case 'source:object':
      return Effect.succeed({ activities: code.activities })
  }
}

export interface FileNotFound extends Data.Case.Constructor<any> {
  readonly _tag: 'FileNotFound'
  attemptedPath?: string
  error: unknown
}

export const FileNotFound = Data.tagged<FileNotFound>('FileNotFound')

export interface WorkflowCodeNotFound extends Data.Case.Constructor<any> {
  readonly _tag: 'WorkflowCodeNotFound'
  attemptedPath?: string
  error: unknown
}

export const WorkflowCodeNotFound = Data.tagged<WorkflowCodeNotFound>(
  'WorkflowCodeNotFound'
)

/**
 * Resolves `WorkflowCode` to something that can be passed to `Worker.create`.
 *
 * @throws `WorkflowCodeNotFound` - if a code reference is provided that cannot be resolved
 * @param code
 */
export const resolveWorkflowCode = (
  code: WorkflowCode
): Effect.Effect<
  { workflowsPath: string } | { workflowBundle: WorkflowBundleOption },
  WorkflowCodeNotFound
> => {
  switch (code.type) {
    case 'source:filepath':
      return pipe(
        resolveFilepathOrFail(code.path),
        Effect.mapBoth({
          onSuccess: (path) => ({ workflowsPath: path }),
          onFailure: (e) =>
            WorkflowCodeNotFound({
              attemptedPath: code.path,
              error: e,
            }),
        })
      )

    case 'compiled:string':
      return Effect.succeed({ workflowBundle: { code: code.code } })

    case 'compiled:filepath':
      return pipe(
        resolveFilepathOrFail(code.path),
        Effect.mapBoth({
          onSuccess: (path) => ({ workflowBundle: { codePath: path } }),
          onFailure: (e) => WorkflowCodeNotFound({ error: e }),
        })
      )
  }
}

// TODO. this needs to be in util or something
const LogLevelSchema = S.Literal<
  [
    LogLevel.All['_tag'],
    LogLevel.Fatal['_tag'],
    LogLevel.Error['_tag'],
    LogLevel.Warning['_tag'],
    LogLevel.Info['_tag'],
    LogLevel.Debug['_tag'],
    LogLevel.Trace['_tag'],
    LogLevel.None['_tag']
  ]
>('All', 'Fatal', 'Error', 'Warning', 'Info', 'Debug', 'Trace', 'None')
export type LogLevels = S.Schema.Type<typeof LogLevelSchema>

export const TemporalWorkerConfig = S.Struct({
  namespace: S.String,
  taskQueue: S.String,
  connection: TemporalConfig.pipe(S.pick('clientCert', 'clientKey', 'address')),
  workflows: S.optional(WorkflowCode),
  activities: S.optional(ActivityCode),
  logLevel: S.optional(LogLevelSchema),
  k8sHTTPHealthCheckDisabled: S.optional(S.Boolean),
  healthCheckConfig: S.optional(HealthCheckServerConfig, {
    default: () => ({
      port: 8080,
      startupProbe: { path: '/startup' },
      livenessProbe: { path: '/liveness' },
      readinessProbe: { path: '/readiness' },
    }),
  }),
  workerOptions: S.optional(
    S.Record(S.String, S.Unknown) as unknown as S.Schema<Partial<WorkerOptions>>
  ),
})
export type TemporalWorkerConfig = S.Schema.Encoded<
  typeof TemporalWorkerConfig
> & { workerOptions?: Partial<WorkerOptions> }

const temporalToEffectLevel = {
  DEBUG: LogLevel.Debug,
  ERROR: LogLevel.Error,
  INFO: LogLevel.Info,
  WARN: LogLevel.Warning,
  TRACE: LogLevel.Trace,
}
const temporalToEffectLogMethod = {
  DEBUG: Effect.logDebug,
  ERROR: Effect.logError,
  INFO: Effect.logInfo,
  WARN: Effect.logWarning,
  TRACE: Effect.logTrace,
}

export const buildTemporalWorkerLogger = (
  runtime: Runtime.Runtime<any> | Runtime.Runtime<never>,
  id?: string
): TemporalRuntimeLogger => {
  const runSync = Runtime.runSync(runtime)

  return {
    log(_level: TemporalLogLevel, message: string, meta?: LogMetadata): void {
      if (meta) {
        return pipe(
          message,
          temporalToEffectLogMethod[_level],
          Effect.annotateLogs(meta),
          runSync
        )
      }
      pipe(message, temporalToEffectLogMethod[_level], runSync)
    },

    debug(message: string, meta?: LogMetadata): void {
      this.log('DEBUG', message, meta)
    },
    error(message: string, meta?: LogMetadata): void {
      this.log('ERROR', message, meta)
    },
    info(message: string, meta?: LogMetadata): void {
      this.log('INFO', message, meta)
    },
    trace(message: string, meta?: LogMetadata): any {
      this.log('TRACE', message, meta)
    },
    warn(message: string, meta?: LogMetadata): any {
      this.log('WARN', message, meta)
    },
  }
}

export const startHealthCheckServer = async (
  worker: Worker,
  healthCheckConfig: HealthCheckServerConfig
) =>
  run(healthCheckConfig, {
    isReady: async () => {
      const state = worker.getState()
      return { ok: state === 'RUNNING', message: `Worker is ${state}` }
    },
    isStarted: async () => {
      const state = worker.getState()
      return { ok: state === 'RUNNING', message: `Worker is ${state}` }
    },
    isLive: async () => {
      const state = worker.getState()
      return { ok: state === 'RUNNING', message: `Worker is ${state}` }
    },
  })

export type WorkerWrapper = {
  worker: Worker
  start: () => void
  stop: () => Promise<void>
}
// export async function createWorker(
//   config: Omit<TemporalWorkerConfig,'connection'>,
//   connection: NativeConnection,
//   logger?: Logger.Logger<any,any): Promise<{
//   worker: Worker
//   start: () => void
//   close: () => void
// }>

export const buildLoggerEffectRuntime = (
  logger: Logger.Logger<any, any> | undefined,
  logLevel: LogLevels
) => {
  if (logger) {
    return pipe(
      Layer.provide(
        Logger.replace(Logger.defaultLogger, logger),
        Logger.minimumLogLevel(LogLevel.fromLiteral(logLevel || 'Info'))
      ),
      Layer.toRuntime,
      Effect.scoped,
      Effect.runSync
    )
  } else {
    return pipe(
      Layer.provide(
        Logger.replace(Logger.defaultLogger, Logging.customLogger()),
        Logger.minimumLogLevel(LogLevel.fromLiteral(logLevel || 'Info'))
      ),
      Layer.toRuntime,
      Effect.scoped,
      Effect.runSync
    )
  }
}

export async function createWorker(
  config: TemporalWorkerConfig, //| Omit<TemporalWorkerConfig,'connection'>,
  connection?: NativeConnection,
  logger?: Logger.Logger<any, any>
): Promise<WorkerWrapper> {
  const workerConfig = S.decodeUnknownSync(TemporalWorkerConfig)(config, {
    errors: 'all',
  })

  // FIXME: this should not be as any
  const runtime = buildLoggerEffectRuntime(logger, workerConfig.logLevel as any)
  const temporalLogger = buildTemporalWorkerLogger(runtime, 'worker')
  try {
    TemporalWorkerRuntime.install({
      logger: temporalLogger,
      telemetryOptions: {
        metrics: {
          prometheus: { bindAddress: '0.0.0.0:9090' },
        },
      },
    })
  } catch (e) {
    if (e instanceof IllegalStateError) {
      // Electing to silence as it will happen often in the reloadable worker...
      // console.warn('Runtime.install error', e)
    } else {
      console.error(e)
    }
  }

  const conn =
    connection ||
    (await NativeConnection.connect({
      address: workerConfig.connection.address,
      tls:
        workerConfig.connection.clientCert && workerConfig.connection.clientKey
          ? {
              clientCertPair: {
                crt: Buffer.from(workerConfig.connection.clientCert),
                key: Buffer.from(workerConfig.connection.clientKey),
              },
            }
          : null,
    }))

  const workflowCode = workerConfig.workflows
    ? await Effect.runPromise(resolveWorkflowCode(workerConfig.workflows))
    : undefined

  const activityCode = workerConfig.activities
    ? await Effect.runPromise(resolveActivityCode(workerConfig.activities))
    : undefined

  const resolvedOptions: WorkerOptions = {
    connection: conn,
    namespace: workerConfig.namespace,
    ...workflowCode,
    ...activityCode,
    sinks: { ...loggerSink },
    reuseV8Context: true,
    taskQueue: workerConfig.taskQueue,
    ...(workerConfig.workerOptions || {}),
  }

  const worker = await Worker.create(resolvedOptions)
  let p: Promise<any> | null
  let t = new Trigger()
  let healthCheckServer: HealthCheckServer
  return {
    worker,
    start: (): void => {
      // @ts-expect-error
      p = worker.runUntil(t)
      if (!workerConfig.k8sHTTPHealthCheckDisabled) {
        startHealthCheckServer(worker, workerConfig.healthCheckConfig).then(
          (x) => {
            healthCheckServer = x
          }
        )
      }
      return
    },
    stop: async () => {
      // @ts-ignore
      t.resolve(undefined)
      p = null
      if (!workerConfig.k8sHTTPHealthCheckDisabled) {
        try {
          await healthCheckServer.stop()
        } catch (e) {
          console.error('Error stopping health check server', e)
        }
      }

      try {
        worker.shutdown()
      } catch (e) {
        console.error('Error shutting down worker', e)
      }
    },
  }
}
