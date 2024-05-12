import '@diachronic/workflow/workflow-runtime'
import { makeWorkflow } from '../../src'
import { machine, signals } from './workflow1info'
import * as Effect from 'effect/Effect'

console.log('enter workflow to defer to next state machine timers')
export const theWorkflow = makeWorkflow({
  name: 'theWorkflow',
  machine,
  signals,
  receive: ({ state, context }) =>
    Effect.succeed({ state, context, timers: {} }),
})
