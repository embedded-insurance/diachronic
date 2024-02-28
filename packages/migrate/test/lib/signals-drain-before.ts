import '@diachronic/workflow/workflow-runtime'
import { assign, createMachine } from 'xstate'
import * as S from '@effect/schema/Schema'
import * as wf from '@temporalio/workflow'
import { makeWorkflow } from '../../src'
import * as Effect from 'effect/Effect'
import { canInterruptTag } from '../../src/can-migrate'
import { defaultLogFunction } from '@diachronic/workflow/workflow-logging'

export type Context = {
  events?: any[]
  hey?: { hey: 'hey' }
}
const log = (k: string, v?: any) =>
  defaultLogFunction({ message: k, annotations: v } as any)
const activities = wf.proxyActivities<{ hello: () => Promise<string> }>({
  scheduleToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 1 },
})
const machine = createMachine(
  {
    id: 'test',
    initial: 'initial',
    types: {} as { context: Context },
    context: {},
    on: {
      '*': {
        actions: [
          (a) => log('LOOK', a.event),
          assign({
            events: ({ context, event }) => {
              return [...(context.events || []), event.payload]
            },
          }),
        ],
      },
    },
    states: {
      initial: {
        on: {
          hey: {
            actions: [
              (a) => log('LOOK', a.event),
              assign({
                events: ({ context, event }) => [
                  ...(context.events || []),
                  event.payload,
                ],
              }),
            ],
            target: 'second',
          },
        },
      },
      second: {
        tags: [canInterruptTag],
        // invoke: {
        //   src: fromPromise(activities.hello),
        //   onDone: 'done',
        //   onError: 'error',
        // },
      },
      error: {},
      done: { type: 'final' },
    },
  },
  {
    delays: {
      time: ({ context }) => {
        console.log('getting delay 1')
        return 100_000
      },
    },
  }
)

const signals = {
  hey: S.struct({ type: S.literal('hey'), payload: S.any }),
}

log('hey')
export const theWorkflow = makeWorkflow(
  'theWorkflow',
  machine,
  signals,
  ({ state, context, timers }) =>
    Effect.succeed({
      state: 'second',
      context,
      timers,
    }),
  undefined,
  { error: log, info: log, debug: log }
)
