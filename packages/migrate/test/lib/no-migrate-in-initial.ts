import '@diachronic/workflow/workflow-runtime'
import { makeWorkflow } from '../../src'
import { machine, signals } from './workflow1info'
import { createMachine } from 'xstate'
import * as R from 'ramda'
import { noMigrateTag } from '../../src/can-migrate'

console.log('no migrate when in initial state workflow')

export const noMigrateInInitialMachine = createMachine(
  R.assocPath(['states', 'initial', 'tags'], [noMigrateTag], machine.config),
  // @ts-ignore
  machine.implementations
)

export const theWorkflow = makeWorkflow(
  'theWorkflow',
  noMigrateInInitialMachine,
  signals
)
