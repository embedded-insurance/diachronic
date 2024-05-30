import * as Context from 'effect/Context'
import * as mqtt from 'mqtt'
import * as Layer from 'effect/Layer'
import { pipe } from 'effect/Function'
import * as Effect from 'effect/Effect'
import * as S from '@effect/schema/Schema'
import { UnknownException } from 'effect/Cause'

export type MQTTClient = mqtt.MqttClient
export const MQTTClient = Context.GenericTag<MQTTClient>('mqtt/MqttClient')

// todo. return effectified methods
type Client = {
  publish: (
    topic: string,
    message: string | Buffer
  ) => Effect.Effect<unknown, unknown, MQTTClient>
  subscribe: (topic: string) => Effect.Effect<unknown, unknown, MQTTClient>
}

// FIXME. this blows up on generate .dts...????
export const MQTTTestImpl = () => {
  let subscriptions = {} as Record<string, Array<(x: any) => void>>

  class _MQTTTestImpl extends mqtt.MqttClient {
    constructor() {
      super({} as any, {} as any)
    }

    connect(): this {
      return this
    }

    override subscribe(topic: string): mqtt.MqttClient {
      subscriptions[topic] = subscriptions[topic] || []
      subscriptions[topic].push((x) => {
        this.emit.bind(this)('message', topic, x, '' as any)
      })
      return this
    }

    async subscribeAsync(topic: string) {
      subscriptions[topic] = subscriptions[topic] || []
      let fn = (x: any) => {
        this.emit.bind(this)('message', topic, x, '' as any)
      }
      subscriptions[topic].push(fn)
      return []
    }

    async publishAsync(
      topic: string,
      message: string | Buffer,
      opts?: any
    ): Promise<undefined> {
      subscriptions[topic]?.forEach((x) => x(message))
      return
    }
  }

  return new _MQTTTestImpl()
}

export const MQTTTest = (args: { brokerURL: string }, impl = MQTTTestImpl()) =>
  Layer.succeed(MQTTClient, MQTTClient.of(impl))

export class MQTTConnectionRefusedError extends S.TaggedError<MQTTConnectionRefusedError>()(
  'MQTTConnectionRefusedError',
  {
    url: S.String,
    message: S.String,
    stack: S.optional(S.Any),
  }
) {
  public nonRetryable = false
}

export const MQTTLive = (args: { brokerURL: string }) =>
  Layer.scoped(
    MQTTClient,
    pipe(
      Effect.acquireRelease(
        pipe(
          Effect.tryPromise({
            try: () => mqtt.connectAsync(args.brokerURL),
            catch: (e) => {
              if (e instanceof AggregateError) {
                if ('code' in e && e.code === 'ECONNREFUSED') {
                  return new MQTTConnectionRefusedError({
                    ...e,
                    message: e.message,
                    url: args.brokerURL,
                  })
                }
              }
              return new UnknownException(e)
            },
          }),
          Effect.tapErrorCause((e) => Effect.logError(e))
        ),
        (client) => Effect.promise(() => client.endAsync())
      )
    )
  )
