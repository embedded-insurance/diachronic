import * as Effect from 'effect/Effect'
import { MQTTClient } from './mqtt'
import { UUIDGenerator } from '@diachronic/util/uuid'
import { signal, signalWithStart } from '@effect-use/temporal-client'
import { pipe } from 'effect/Function'
import * as Duration from 'effect/Duration'
import type { TemporalClient } from '@effect-use/temporal-client'
import { WorkflowRequestMetaKey } from './types'

type UpdateInstruction = any // TODO

const DEFAULT_TIMEOUT = Duration.millis(5000)

// TODO. get the expected return type to type-check
// and make it generic for input/output of a request-response
/**
 * Sends a signal to a workflow and waits for a reply
 * Coordination is performed over MQTT
 * Workflow must be configured to listen for the signal and reply to the topic
 * provided in the meta field of the signal
 * @param instr
 * @param requestTimeout
 */
export const workflowUpdate = (
  instr: UpdateInstruction,
  requestTimeout: Duration.Duration = DEFAULT_TIMEOUT
): Effect.Effect<any, any, TemporalClient | MQTTClient | UUIDGenerator> =>
  pipe(
    Effect.Do,
    Effect.bind(
      'reply',
      (): Effect.Effect<{
        topic: string
        listener: Effect.Effect<any, unknown>
      }, unknown, MQTTClient | UUIDGenerator> =>
        Effect.map(Effect.all([MQTTClient, UUIDGenerator]), ([mqtt, uuid]) => {
          const requestId = uuid()
          const topic = `v1/request-response/${requestId}`

          return {
            topic,
            listener: Effect.async((resolve, signal) => {
              const callback = (_topic: any, message: any) => {
                if (_topic !== topic) {
                  //                  console.debug('unexpected topic. ignoring', topic, message)
                  return
                }

                mqtt.unsubscribe(topic)
                mqtt.off('message', callback)

                let result
                try {
                  result = JSON.parse(message.toString())
                } catch (e) {
                  console.error('error parsing message', e)
                  return resolve(Effect.fail(e))
                }

                return resolve(Effect.succeed(result))
              }

              signal.onabort = () => {
                console.info('aborting')
                mqtt.unsubscribe(topic)
                mqtt.off('message', callback)
              }

              mqtt.on('message', callback)
              mqtt.subscribe(topic)
            }) as Effect.Effect<any, unknown>,
          };
        })
    ),
    Effect.flatMap(({ reply }): Effect.Effect<any, unknown, TemporalClient> => {
      if (instr.action === 'update') {
        const input = instr.args
        const signalEffect = signal({
          ...input,
          signalArgs: [
            {
              ...(input.signalArgs[0] as any),
              [WorkflowRequestMetaKey]: {
                ...(input.signalArgs[0]?.[WorkflowRequestMetaKey] as any),
                topic: reply.topic,
              },
            },
          ],
        })
        return Effect.all(
          [
            Effect.raceAll([
              pipe(
                reply.listener,
                Effect.tap((result) =>
                  Effect.logInfo('Got reply' + JSON.stringify(result))
                )
              ),
              pipe(
                Effect.logDebug(
                  `Waiting for ${Duration.toMillis(
                    requestTimeout
                  )} milliseconds before timing out`
                ),
                Effect.delay(requestTimeout),
                Effect.tap(() =>
                  Effect.logInfo(
                    `Request timed out after ${Duration.toMillis(
                      requestTimeout
                    )} milliseconds`
                  )
                ),
                Effect.matchEffect({
                  onFailure: (e) => {
                    console.error('Unexpected timer failure', e)
                    return Effect.fail(e)
                  },
                  onSuccess: (_) =>
                    Effect.fail({
                      _tag: 'RequestResponseTimedOut',
                      message: `Timed out after ${Duration.toMillis(
                        requestTimeout
                      )} milliseconds`,
                    }),
                })
              ),
            ] as const),
            pipe(
              Effect.logDebug('Sending signal....'),
              Effect.flatMap(() => signalEffect),
              Effect.tap(() => Effect.logDebug('Signal sent'))
            ),
          ],
          { concurrency: 2 }
        )
      }

      // TODO. maybe provide workflow  info in the response meta,
      //  including whether a workflow was started as a result of this call
      /////// updateOrStart
      const input = instr.args
      const signalOrStartEffect = signalWithStart({
        ...input,
        signalArgs: [
          {
            ...(input.signalArgs[0] as any),
            [WorkflowRequestMetaKey]: {
              ...(input.signalArgs[0]?.[WorkflowRequestMetaKey] as any),
              topic: reply.topic,
            },
          },
        ],
      })
      return Effect.all(
        [
          Effect.raceAll([
            pipe(
              reply.listener,
              Effect.tap((result) =>
                Effect.logInfo('Got reply' + JSON.stringify(result))
              )
            ),
            pipe(
              Effect.logDebug(
                `Waiting for ${Duration.toMillis(
                  requestTimeout
                )} milliseconds before timing out`
              ),
              Effect.delay(requestTimeout),
              Effect.tap(() =>
                Effect.logInfo(
                  `Request timed out after ${Duration.toMillis(
                    requestTimeout
                  )} milliseconds`
                )
              ),
              Effect.matchEffect({
                onFailure: (e) => {
                  console.error('Unexpected timer failure', e)
                  return Effect.fail(e)
                },
                onSuccess: (_) =>
                  Effect.fail({
                    _tag: 'RequestResponseTimedOut',
                    message: `Timed out after ${Duration.toMillis(
                      requestTimeout
                    )} milliseconds`,
                  }),
              })
            ),
          ] as const),
          pipe(
            Effect.logDebug('Sending signal....'),
            Effect.flatMap(() => signalOrStartEffect),
            Effect.tap(() => Effect.logDebug('Signal sent'))
          ),
        ],
        { concurrency: 2 }
      )
    }),
    // Success path is only reachable when a reply from workflow
    // Timeout is mapped to error (and races with the reply)
    // so we only ever see the reply here (+ the signal result)
    Effect.map(([reply, _signalResult]) => reply)
  )
