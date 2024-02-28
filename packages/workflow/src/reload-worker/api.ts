import * as S from '@effect/schema/Schema'
import { pipe } from 'effect/Function'
import { Effect } from 'effect'
import { MQTTClient } from '@diachronic/workflow-request-response/mqtt'

export const Reload = pipe(
  S.struct({
    type: S.literal('reload'),
    payload: S.struct({
      url: S.string,
      from: pipe(
        S.string,
        S.description(
          'The address of the sender, to which this process will reply. For MQTT this is a topic the sender creates and subscribes to.'
        )
      ),
    }),
  }),
  S.description(
    'An instruction to reload the workflow and activity bundle with the code at the provided URL.'
  )
)
export type Reload = S.Schema.To<typeof Reload>

export type MessageType = Reload

export const reply = (to: string, payload: any) =>
  Effect.flatMap(MQTTClient, (mqtt) =>
    Effect.tryPromise(() => mqtt.publishAsync(to, JSON.stringify(payload)))
  )
