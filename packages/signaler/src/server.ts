import Fastify from 'fastify'
import { Effect, Layer } from 'effect'
import { register } from '@diachronic/http/register'
import { pipe } from 'effect/Function'
import { createTemporalClientLayer } from '@effect-use/temporal-client'
import { configFromEnv } from '@effect-use/temporal-config'
import { SignalerConfig } from './types'
import { handler } from './handlers'
import { makeFeatureFlagClientLayer } from '@diachronic/feature-flag-client'
import { MQTTLive } from '@diachronic/workflow-request-response/mqtt'
import { UUIDLive } from '@diachronic/util/uuid'

export const createServer = async (args: SignalerConfig) => {
  const server = Fastify()

  const runtime = await pipe(
    makeFeatureFlagClientLayer({
      serverURL: '',
      apiKey: '',
      fallbackToDefaultsForEverythingOnClientConstructionFailure: true,
    }),
    Layer.provideMerge(MQTTLive({} as any)),
    Layer.provideMerge(createTemporalClientLayer(configFromEnv(args))),
    Layer.provideMerge(UUIDLive),
    Layer.toRuntime,
    Effect.scoped,
    Effect.runPromise
  )
  register(server, handler, runtime)

  return server
}
