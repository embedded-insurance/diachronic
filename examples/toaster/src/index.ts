import '@diachronic/workflow/workflow-runtime'
import { ActorRef, assign, createMachine } from 'xstate'
import { Clock, Context, Effect, Layer, Logger, LogLevel, pipe } from 'effect'
import * as S from '@effect/schema/Schema'
import { CallableGroup } from '@diachronic/activity/effect'
import { mapGroupToScheduleActivities } from '@diachronic/workflow/activities'
import { makeWorkflow } from '@diachronic/migrate'

export const ToasterContext = S.partial(
  S.struct({
    numberOfToasts: S.number.pipe(S.int(), S.positive()),
    pluggedIn: S.boolean,
    toastTimeDuration: S.number,
  })
)

export type ToasterContext = S.Schema.To<typeof ToasterContext>

const Signals = {
  'set-toast-time': S.struct({ duration: S.number }),
  'plug-it-in': S.undefined,
  'unplug-it': S.undefined,
}
// needs standardized on something
const Signals2 = {
  'set-toast-time': S.struct({
    type: S.literal('set-toast-time'),
    payload: S.struct({ duration: S.number }),
  }),
  'plug-it-in': S.struct({
    type: S.literal('plug-it-in'),
    payload: S.undefined,
  }),
  'unplug-it': S.struct({
    type: S.literal('plug-it-in'),
    payload: S.undefined,
  }),
}

type ToasterEvents = {
  [K in keyof typeof Signals]: {
    type: K
    payload: S.Schema.To<(typeof Signals)[K]>
  }
}[keyof typeof Signals]

export const makeDelays = () => ({
  'toast-time': ({ context }: { context: ToasterContext }) => {
    if (!context.toastTimeDuration) {
      throw new Error('Impossible')
    }
    return context.toastTimeDuration
  },
})
export type ToasterDelays = ReturnType<typeof makeDelays>

type ToasterMachineTypes = {
  context: ToasterContext
  events: ToasterEvents
  delays: keyof ToasterDelays
}
export const makeToasterMachine = ({ delays }: { delays: ToasterDelays }) =>
  createMachine(
    {
      id: 'toaster',
      initial: 'OFF',
      context: {
        numberOfToasts: 0,
        pluggedIn: false,
        toastTimeDuration: undefined,
      },
      types: {} as ToasterMachineTypes,
      states: {
        OFF: {
          on: {
            'plug-it-in': [
              {
                guard: ({ context }) => !!context.toastTimeDuration,
                actions: [assign({ pluggedIn: () => true })],
                target: 'ON',
              },
              {
                actions: [assign({ pluggedIn: () => true })],
              },
            ],
            'set-toast-time': [
              {
                guard: ({ context }) => !!context.pluggedIn,
                actions: [
                  assign({
                    toastTimeDuration: ({ event }) => event.payload.duration,
                  }),
                ],
                target: 'ON',
              },
              {
                actions: [
                  assign({
                    toastTimeDuration: ({ event }) => event.payload.duration,
                  }),
                ],
              },
            ],
          },
        },
        ON: {
          after: [
            {
              delay: 'toast-time',
              actions: [assign({ toastTimeDuration: () => undefined })],
              target: 'OFF',
            },
          ],
          on: {
            'unplug-it': {
              actions: [
                assign({ pluggedIn: () => false }),
                assign({ toastTimeDuration: () => undefined }),
              ],
              target: 'OFF',
            },
          },
        },
      },
    },
    { delays }
  )

export type ToasterMachine = ReturnType<typeof makeToasterMachine>

const delays = makeDelays()

export const toaster = makeWorkflow({
  name: 'toaster',
  machine: makeToasterMachine({ delays }),
  signals: Signals2,
})
