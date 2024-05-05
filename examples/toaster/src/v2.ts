import '@diachronic/workflow/workflow-runtime'
import { assign, createMachine } from 'xstate'
import { Effect, pipe } from 'effect'
import * as S from '@effect/schema/Schema'
import { makeWorkflow, MigrationFnV1 } from '@diachronic/migrate'
import * as V1 from '.'

const PosInt = S.number.pipe(S.int(), S.positive())

export const ToasterContext = S.partial(
  S.struct({
    numberOfToasts: PosInt,
    powered: S.boolean,
    toastTimeDuration: S.number,
  })
)

export type ToasterContext = S.Schema.To<typeof ToasterContext>

const Signals = {
  'set-toast-time': S.struct({ duration: S.number }),
  'power-on': S.struct({ volts: PosInt }),
  'power-off': S.undefined,
}
const Signals2 = {
  'set-toast-time': S.struct({
    type: S.literal('set-toast-time'),
    payload: S.struct({ duration: S.number }),
  }),
  'power-on': S.struct({
    type: S.literal('power-on'),
    payload: S.struct({ volts: PosInt }),
  }),
  'power-off': S.struct({
    type: S.literal('power-off'),
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
    console.log('i am a delay')
    if (!context.toastTimeDuration) {
      throw new Error('Impossible')
    }
    return context.toastTimeDuration
  },
})
type ToasterDelays = ReturnType<typeof makeDelays>

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
        powered: false,
        toastTimeDuration: undefined,
      },
      types: {} as ToasterMachineTypes,
      states: {
        OFF: {
          on: {
            'power-on': [
              {
                guard: ({ context, event }) =>
                  event.payload.volts >= 100 && !!context.toastTimeDuration,
                actions: [assign({ powered: () => true })],
                target: 'ON',
              },
              {
                guard: ({ event }) => event.payload.volts >= 100,
                actions: [assign({ powered: () => true })],
              },
            ],
            'set-toast-time': [
              {
                guard: ({ context }) => !!context.powered,
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
            'power-off': {
              actions: [
                assign({ powered: () => false }),
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

type Prev = {
  context: V1.ToasterContext
  machine: V1.ToasterMachine
  delays: { [K in keyof V1.ToasterDelays]: undefined }
  migrationStates: 'ON' | 'OFF'
}

type Next = {
  context: ToasterContext
  machine: ToasterMachine
  delays: { [K in keyof ToasterDelays]: undefined }
  migrationStates: 'ON' | 'OFF'
}

const powerMigration: MigrationFnV1<Prev, Next> = (args) =>
  pipe(
    Effect.try(() => {
      const { pluggedIn, ...rest } = args.context
      return {
        ...args,
        context: {
          ...rest,
          powered: args.context.pluggedIn,
        },
      }
    }),
    Effect.tapErrorCause((cause) =>
      Effect.logError('Migration function failed', cause)
    ),
    Effect.catchAll(() => Effect.succeed(args))
  )

export const toaster = makeWorkflow({
  name: 'toaster',
  machine: makeToasterMachine({ delays }),
  signals: Signals2,
  receive: powerMigration,
  logger: {
    error: console.error,
    info: console.info,
    debug: console.debug,
  },
})
