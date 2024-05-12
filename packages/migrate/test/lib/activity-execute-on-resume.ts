import '@diachronic/workflow/workflow-runtime'
import { createMachine, fromPromise } from 'xstate'
import * as S from '@effect/schema/Schema'
import * as wf from '@temporalio/workflow'
import { makeWorkflow } from '../../src'
import * as Effect from 'effect/Effect'

export type Context = { hey?: { hey: 'hey' } }
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
    states: {
      initial: {
        on: {
          hey: {
            target: 'second',
          },
        },
      },
      second: {
        invoke: {
          src: fromPromise(activities.hello),
          onDone: 'done',
          onError: 'error',
        },
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
  hey: S.struct({ type: S.literal('hey'), payload: S.string }),
}

export const theWorkflow = makeWorkflow({
  name: 'theWorkflow',
  machine,
  signals,
  receive: ({ state, context, timers }) =>
    Effect.succeed({
      state: 'second',
      context,
      timers,
    }),
})
