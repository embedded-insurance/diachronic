import '@diachronic/workflow/workflow-runtime'
import { makeWorkflow } from '../../src'
import { signals } from './workflow1info'
import { machine } from './workflowv3info'
import * as Effect from 'effect/Effect'

console.log('I am the workflow v3 (with some other state to start in)')
export const theWorkflow = makeWorkflow({
  name: 'theWorkflow',
  machine,
  signals,
  receive: (a) => {
    console.log('workflow v3 deciding what to do next')
    return Effect.succeed({
      state: '#test.completely-different-state',
      context: a.context,
      // not valid but just to show we guard against it
      timers: a.timers as never, // todo. type checking,
    })
  },
})
