import '@diachronic/workflow/workflow-runtime'
import { makeWorkflow } from '../../src'
import { machine, signals } from './workflow1info'
import { createMachine } from 'xstate'

console.log('I am the workflow v2')
export const theWorkflow = makeWorkflow(
  'theWorkflow',
  createMachine(machine.config, {
    ...machine.implementations,
    delays: {
      time: () => {
        console.log('getting delay 2')
        return 0
      },
    },
  }),
  signals
)
