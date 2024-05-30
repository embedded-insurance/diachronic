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

const WorkflowDeployEventPayload = S.Struct({
  workflowName: S.String,
  versionId: S.String,
  sha: S.String,
  environment: S.Union(S.Literal('development'), S.Literal('production')),
  eventTime: ISODateString,
  isNonMigratory: S.optional(S.Boolean, { default: () => false }),
  isDarkDeploy: S.optional(S.Boolean, { default: () => false }),
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

export const WorkflowDeploymentSuccessEvent = S.Struct({
  type: S.Literal('diachronic.ci.workflow.deploy.success'),
  payload: WorkflowDeployEventPayload,
})

export const WorkflowDeployEvent = S.Union(
  WorkflowDeploymentSuccessEvent,
  S.Struct({
    type: S.Literal('diachronic.ci.workflow.deploy.pending'),
    payload: WorkflowDeployEventPayload,
  }),
  S.Struct({
    type: S.Literal('diachronic.ci.workflow.deploy.queued'),
    payload: WorkflowDeployEventPayload,
  }),
  S.Struct({
    type: S.Literal('diachronic.ci.workflow.deploy.waiting'),
    payload: WorkflowDeployEventPayload,
  }),
  S.Struct({
    type: S.Literal('diachronic.ci.workflow.deploy.in_progress'),
    payload: WorkflowDeployEventPayload,
  }),
  S.Struct({
    type: S.Literal('diachronic.ci.workflow.deploy.error'),
    payload: WorkflowDeployEventPayload,
  }),
  S.Struct({
    type: S.Literal('diachronic.ci.workflow.deploy.failure'),
    payload: WorkflowDeployEventPayload,
  })
)
