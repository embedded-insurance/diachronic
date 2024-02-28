import '@diachronic/workflow/workflow-runtime'
import { migration as migrationWorkflow } from './workflow-migration'
import { workflowCI as workflowCIWorkflow } from './workflow-ci'
import { rollout as rolloutWorkflow } from './workflow-rollout'
import { cleanup as cleanupWorkflow } from './workflow-cleanup'

export const rollout = rolloutWorkflow

export const migration = migrationWorkflow

export const cleanup = cleanupWorkflow

export const workflowCI = workflowCIWorkflow
