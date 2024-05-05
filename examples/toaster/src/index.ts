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

export const ToasterActivitiesSchema = {}
const activities = mapGroupToScheduleActivities(ToasterActivitiesSchema)

export type WorkflowActivities = CallableGroup<typeof ToasterActivitiesSchema>
export const WorkflowActivities = Context.Tag<WorkflowActivities>()

export const makeWorkflowRuntime = (args: {
  clock: Clock.Clock
  activities: WorkflowActivities
  logLevel?: LogLevel.Literal
}) =>
  pipe(
    Layer.mergeAll(
      Layer.succeed(WorkflowActivities, args.activities),
      Layer.succeed(Clock.Clock, args.clock)
    ),
    Layer.toRuntime,
    Logger.withMinimumLogLevel(LogLevel.fromLiteral(args.logLevel || 'Debug')),
    Effect.scoped,
    Effect.runSync
  )

export type WorkflowRuntime = ReturnType<typeof makeWorkflowRuntime>

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

type ActionArgs = {
  context: ToasterContext
  event: ToasterEvents
  self: ActorRef<ToasterEvents, ToasterContext>
}

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

const runtime = makeWorkflowRuntime({
  activities,
  clock: Clock.make(),
  logLevel: 'Info',
})
const delays = makeDelays()

type Prev = {
  context: ToasterContext
  machine: ToasterMachine
  delays: ToasterDelays
  migrationStates: any
}
type Next = Prev

export const toaster = makeWorkflow({
  name: 'toaster',
  machine: makeToasterMachine({ delays }),
  signals: Signals2,
})
