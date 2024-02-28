import * as S from '@effect/schema/Schema'
import { ISODateString } from '@diachronic/util/isoDate'

export type WorkflowDeployEventPayload = {
  workflowName: string
  versionId: string
  sha: string
  environment: 'development' | 'production'
  eventTime: ISODateString
  isNonMigratory?: boolean | undefined
  isDarkDeploy?: boolean
}

const WorkflowDeployEventPayload = S.struct({
  workflowName: S.string,
  versionId: S.string,
  sha: S.string,
  environment: S.union(S.literal('development'), S.literal('production')),
  eventTime: ISODateString,
  isNonMigratory: S.optional(S.boolean, { default: () => false }),
  isDarkDeploy: S.optional(S.boolean, { default: () => false }),
})

/**
 * CI Workflow events/signals
 * Mapped from GitHub webhook events
 */
export type WorkflowDeployEvent =
  | {
      type: 'diachronic.ci.workflow.deploy.pending'
      payload: WorkflowDeployEventPayload
    }
  | {
      type: 'diachronic.ci.workflow.deploy.queued'
      payload: WorkflowDeployEventPayload
    }
  | {
      type: 'diachronic.ci.workflow.deploy.waiting'
      payload: WorkflowDeployEventPayload
    }
  | {
      type: 'diachronic.ci.workflow.deploy.in_progress'
      payload: WorkflowDeployEventPayload
    }
  | {
      type: 'diachronic.ci.workflow.deploy.error'
      payload: WorkflowDeployEventPayload
    }
  | {
      type: 'diachronic.ci.workflow.deploy.failure'
      payload: WorkflowDeployEventPayload
    }
  | {
      type: 'diachronic.ci.workflow.deploy.success'
      payload: WorkflowDeployEventPayload
    }

export const WorkflowDeploymentSuccessEvent = S.struct({
  type: S.literal('diachronic.ci.workflow.deploy.success'),
  payload: WorkflowDeployEventPayload,
})

export const WorkflowDeployEvent = S.union(
  WorkflowDeploymentSuccessEvent,
  S.struct({
    type: S.literal('diachronic.ci.workflow.deploy.pending'),
    payload: WorkflowDeployEventPayload,
  }),
  S.struct({
    type: S.literal('diachronic.ci.workflow.deploy.queued'),
    payload: WorkflowDeployEventPayload,
  }),
  S.struct({
    type: S.literal('diachronic.ci.workflow.deploy.waiting'),
    payload: WorkflowDeployEventPayload,
  }),
  S.struct({
    type: S.literal('diachronic.ci.workflow.deploy.in_progress'),
    payload: WorkflowDeployEventPayload,
  }),
  S.struct({
    type: S.literal('diachronic.ci.workflow.deploy.error'),
    payload: WorkflowDeployEventPayload,
  }),
  S.struct({
    type: S.literal('diachronic.ci.workflow.deploy.failure'),
    payload: WorkflowDeployEventPayload,
  })
)
