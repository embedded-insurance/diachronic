export const TIMER_DELAY = 100_000

import { assign, createMachine } from 'xstate'
import * as S from '@effect/schema/Schema'

export type Context = { hey?: { hey: 'hey' } }
export const machine = createMachine(
  {
    id: 'test',
    initial: 'initial',
    types: {} as { context: Context },
    context: {},
    states: {
      initial: {
        on: {
          hey: {
            target: 'heyed',
          },
        },
      },
      heyed: {
        entry: [assign({ hey: () => ({ hey: 'hey' } as const) })],
        after: {
          time: 'done',
        },
      },
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

export const signals = {
  hey: S.struct({ type: S.literal('hey'), payload: S.string }),
}
