import '@diachronic/workflow/workflow-runtime'
import { makeWorkflow } from '../../src'
import { machine, signals } from './workflow1info'

console.log('I am the workflow v1')
export const theWorkflow = makeWorkflow('theWorkflow', machine, signals)
