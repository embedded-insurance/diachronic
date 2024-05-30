import * as S from '@effect/schema/Schema'
import Fastify, { FastifyInstance } from 'fastify'

export const HTTPProbeConfig = S.Struct({ path: S.String })

export const HealthCheckServerConfig = S.Struct({
  port: S.optional(S.Number, { default: () => 8080 }),
  livenessProbe: S.optional(HTTPProbeConfig, {
    default: () => ({
      path: '/liveness',
    }),
  }),
  readinessProbe: S.optional(HTTPProbeConfig, {
    default: () => ({
      path: '/readiness',
    }),
  }),
  startupProbe: S.optional(HTTPProbeConfig, {
    default: () => ({
      path: '/startup',
    }),
  }),
})

export type HealthCheckServerConfig = S.Schema.Type<
  typeof HealthCheckServerConfig
>

export type HealthCheckServer = {
  server: FastifyInstance
  stop: () => Promise<void>
  config: HealthCheckServerConfig
}

export interface HealthChecks {
  isStarted: () => Promise<{ ok: boolean; message?: string }>
  isReady: () => Promise<{ ok: boolean; message?: string }>
  isLive: () => Promise<{ ok: boolean; message?: string }>
}

export const run = async (
  config: HealthCheckServerConfig,
  checks: HealthChecks
): Promise<HealthCheckServer> => {
  const server = Fastify({
    logger: true,
  })

  server.get(config.startupProbe.path, async (_, res) => {
    try {
      const { ok, message } = await checks.isStarted()
      res.status(ok ? 200 : 500).send(message)
    } catch (e) {
      server.log.error(e)
      res.status(500).send()
    }
  })

  server.get(config.readinessProbe.path, async (_, res) => {
    try {
      const { ok, message } = await checks.isReady()
      res.status(ok ? 200 : 500).send(message)
    } catch (e) {
      server.log.error(e)
      res.status(500).send()
    }
  })
  server.get(config.livenessProbe.path, async (_, res) => {
    try {
      const { ok, message } = await checks.isLive()
      res.status(ok ? 200 : 500).send(message)
    } catch (e) {
      server.log.error(e)
      res.status(500).send()
    }
  })

  await server.listen({
    host: '0.0.0.0',
    port: config.port,
  })

  return {
    server,
    config,
    stop: async () => {
      try {
        return await server.close().then(() => {
          console.debug('server stopped')
        })
      } catch (e) {
        console.error('[probe-server] error stopping server', e)
      }
    },
  }
}
