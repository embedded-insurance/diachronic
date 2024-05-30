import * as S from '@effect/schema/Schema'

export const WorkflowVersionInfo = S.extend(
  S.Struct({
    workflowName: S.String,
    versionId: S.String,
    flagName: S.String,
    seqId: S.String,
    taskQueue: S.String,
  }),
  S.partial(S.Struct({ environment: S.String }))
)
export type WorkflowVersionInfo = S.Schema.Type<typeof WorkflowVersionInfo>
