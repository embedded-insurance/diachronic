import * as S from '@effect/schema/Schema'

export class ExternalWorkflowNotFoundError extends S.TaggedError<ExternalWorkflowNotFoundError>()(
  'ExternalWorkflowNotFoundError',
  {
    /**
     * The workflowId that wasn't found
     */
    workflowId: S.string,
    /**
     * The namespace workflow wasn't found in
     */
    namespace: S.optional(S.string),
    /**
     * The runId that was provided to `signal`, if any
     */
    runId: S.optional(S.string),
    /**
     * The correlationId that was provided to `signal`, if any
     */
    correlationId: S.optional(S.string),
  }
) {}

export type SignalExternalWorkflowError =
  | ExternalWorkflowNotFoundError
  | unknown

export type SignalExternalWorkflowOutput = { workflowId: string; runId: string }
