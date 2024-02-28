import { UnknownException } from 'effect/Cause'
import { ApplicationFailure } from '@temporalio/workflow'
import { Runtime } from 'effect'
import { FiberFailureCauseId } from 'effect/Runtime'
import { hasProperty } from 'effect/Predicate'

export interface TypedError extends Error {
  _tag: string
  toJSON: () => Record<'_tag' | string, unknown>
}

export const TypedError = (
  data: Record<'_tag' | string, unknown>
): TypedError => {
  const e = new Error(
    typeof data.message === 'string' ? data.message : JSON.stringify(data)
  )
  e.name = data._tag as string
  Object.keys(data).forEach((k) => {
    if (k !== 'message') {
      // @ts-expect-error
      e[k] = data[k]
    }
  })

  // This has performance cost and doesn't seem to provide a better stack trace
  // Error.captureStackTrace(data)

  // @ts-expect-error
  e.toJSON = () => data
  return e as TypedError
}

export const toApplicationFailure = (e: TypedError | UnknownException) =>
  ApplicationFailure.fromError(e, {
    type: e._tag,
    message: e.message,
    cause: e,
    // @ts-expect-error
    nonRetryable: e.nonRetryable || false,
    details: [e.toJSON()],
  })

/**
 * Used for the caught value of Effect.runPromise
 * @param e
 */
export const getFailure = (e: unknown): TypedError | UnknownException => {
  if (
    Runtime.isFiberFailure(e) &&
    e[FiberFailureCauseId]._tag === 'Fail' &&
    e[FiberFailureCauseId].error
  ) {
    const v = e[FiberFailureCauseId].error
    if (hasProperty('_tag')(v)) {
      if (v instanceof Error) {
        // @ts-expect-error
        return v
      }
      return TypedError(v)
    }
    return new UnknownException(v)
  }
  return new UnknownException(e)
}
