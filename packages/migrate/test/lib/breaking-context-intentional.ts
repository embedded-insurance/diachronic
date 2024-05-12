import '@diachronic/workflow/workflow-runtime'
import * as Effect from 'effect/Effect'
import { makeWorkflow } from '../../src'
import { machine as prevMachine, signals } from './workflow1info'
import { nextMachineBreakingContextIntentional } from './workflow-change-context'

console.log('I am the workflow change context test')
export const theWorkflow = makeWorkflow<
  // @ts-expect-error
  typeof prevMachine,
  typeof nextMachineBreakingContextIntentional
>({
  name: 'theWorkflow',
  machine: nextMachineBreakingContextIntentional,
  signals,
  receive: ({ state, context, timers }) =>
    Effect.succeed({
      state,
      // @ts-expect-error
      context: { yo: context.hey?.hey || 'a string' },
      timers,
    }),
})
