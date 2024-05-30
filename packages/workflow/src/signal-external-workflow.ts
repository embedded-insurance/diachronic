import * as S from '@effect/schema/Schema'

export class ExternalWorkflowNotFoundError extends S.TaggedError<ExternalWorkflowNotFoundError>()(
  'ExternalWorkflowNotFoundError',
  {
    /**
     * The workflowId that wasn't found
     */
    workflowId: S.String,
    /**
     * The namespace workflow wasn't found in
     */
    namespace: S.optional(S.String),
    /**
     * The runId that was provided to `signal`, if any
     */
    runId: S.optional(S.String),
    /**
     * The correlationId that was provided to `signal`, if any
     */
    correlationId: S.optional(S.String),
  }
) {}

export type SignalExternalWorkflowError =
  | ExternalWorkflowNotFoundError
  | unknown

export type SignalExternalWorkflowOutput = { workflowId: string; runId: string }
