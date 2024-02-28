import { ChildWorkflowOptions } from '@temporalio/workflow'
import * as S from '@effect/schema/Schema'
import { ActivityDef } from '@diachronic/activity/activity'

export const workflowDef = <
  const A extends {
    name: string
    input: S.Schema<any, any>
    output: S.Schema<any, any>
    error: S.Schema<any, any>
    ['temporal.workflow']: {
      defaultTemporalOptions?: ChildWorkflowOptions
      signals: Record<string, S.Schema<any, any>>
      childWorkflows?: Record<string, WorkflowDef2>
      activities?: Record<string, ActivityDef>
    }
  }
>(
  a: A
) => {
  // @ts-ignore
  a['temporal.workflow'] = a['temporal.workflow'] || {}
  // @ts-ignore
  a['temporal.workflow'].defaultTemporalOptions =
    a['temporal.workflow'].defaultTemporalOptions ||
    ({} as ChildWorkflowOptions)
  return a as unknown as {
    name: A['name']
    input: A['input']
    output: A['output']
    error: A['error']
    description?: string
    ['temporal.workflow']: {
      defaultTemporalOptions: ChildWorkflowOptions
      signals: A['temporal.workflow']['signals']
      childWorkflows: A['temporal.workflow']['childWorkflows']
      activities: A['temporal.workflow']['activities']
    }
  }
}

export type WorkflowDef = ReturnType<typeof workflowDef>
type WorkflowDef2 = {
  name: string
  input: S.Schema<any, any>
  output: S.Schema<any, any>
  error: S.Schema<any, any>
  ['temporal.workflow']: {
    defaultTemporalOptions?: ChildWorkflowOptions
    signals: Record<string, S.Schema<any, any>>
    childWorkflows?: Record<string, WorkflowDef2>
  }
}
