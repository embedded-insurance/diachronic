import { Context, Layer } from 'effect'
import {
  WorkflowInfo as TemporalWorkflowInfo,
  workflowInfo as temporalWorkflowInfo,
} from '@temporalio/workflow'

export type WorkflowInfo = () => TemporalWorkflowInfo
export const WorkflowInfo = Context.Tag<WorkflowInfo>()

export const WorkflowInfoLayer = (
  workflowInfo: () => TemporalWorkflowInfo = temporalWorkflowInfo
) => Layer.succeed(WorkflowInfo, workflowInfo)
