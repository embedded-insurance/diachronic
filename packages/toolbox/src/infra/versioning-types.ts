import * as S from '@effect/schema/Schema'

export const WorkflowVersionInfo = S.extend(
  S.struct({
    workflowName: S.string,
    versionId: S.string,
    flagName: S.string,
    seqId: S.string,
    taskQueue: S.string,
  }),
  S.partial(S.struct({ environment: S.string }))
)
export type WorkflowVersionInfo = S.Schema.To<typeof WorkflowVersionInfo>
