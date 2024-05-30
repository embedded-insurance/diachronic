import '@diachronic/workflow/workflow-runtime'
import { assign, createMachine } from 'xstate'
import * as S from '@effect/schema/Schema'
import { makeWorkflow } from '@diachronic/migrate'

export const ToasterContext = S.partial(
  S.Struct({
    numberOfToasts: S.Number.pipe(S.int(), S.positive()),
    pluggedIn: S.Boolean,
    toastTimeDuration: S.Number,
  })
)

export type ToasterContext = S.Schema.Type<typeof ToasterContext>

const Signals = {
  'set-toast-time': S.Struct({
    type: S.Literal('set-toast-time'),
    payload: S.Struct({ duration: S.Number }),
  }),
  'plug-it-in': S.Struct({
    type: S.Literal('plug-it-in'),
    payload: S.Undefined,
  }),
  'unplug-it': S.Struct({
    type: S.Literal('unplug-it'),
    payload: S.Undefined,
  }),
}

type ToasterEvents = {
  [K in keyof typeof Signals]: {
    type: K
    payload: S.Schema.Type<(typeof Signals)[K]>['payload']
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
  signals: Signals,
})
