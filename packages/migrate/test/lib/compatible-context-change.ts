import '@diachronic/workflow/workflow-runtime'
import * as Effect from 'effect/Effect'
import { makeWorkflow } from '../../src'
import { nextMachineCompatibleContext } from './workflow-change-context'
import { machine as prevMachine, signals } from './workflow1info'

export const theWorkflow = makeWorkflow<
  // @ts-expect-error
  typeof prevMachine,
  typeof nextMachineCompatibleContext
>({
  name: 'theWorkflow',
  machine: nextMachineCompatibleContext,
  signals,
  receive: ({ state, context, timers }) =>
    Effect.succeed({
      state,
      context: {
        // @ts-expect-error
        hey: { hey: context.hey?.hey || 'hey' },
        // @ts-expect-error
        yo: context.hey?.hey || 'a string',
      },
      timers,
    }),
})
