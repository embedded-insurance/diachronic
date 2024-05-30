import './workflow-runtime'
import { Cause, Exit } from 'effect'
import * as S from '@effect/schema/Schema'

const ParseError = S.Struct({
  _tag: S.Literal('ParseError'),
  errors: S.NonEmptyArray(S.Any),
})

export const handleExitFailure = (result: Exit.Exit<any, any>) => {
  if (Exit.isFailure(result)) {
    const cause = result.cause
    if (Cause.isDie(cause)) {
      // FIXME: log warning if is more than one and re-throw the first
      // I actually don't know how we are going to log if we are not in the effect context :)
      for (const defect of Cause.defects(cause)) {
        // TODO: log the defect?
        throw defect
      }
    }

    if (Cause.isFailure(cause)) {
      for (const failure of Cause.failures(cause)) {
        if (Cause.isFailure(failure) && failure.error instanceof Error) {
          throw failure.error
        }

        if (S.is(ParseError)(Cause.originalError(failure))) {
          console.error(JSON.stringify(Cause.originalError(failure)))
          throw new Error(
            `Parse error: ${JSON.stringify(
              Cause.originalError(failure).errors,
              null,
              2
            )}`
          )
        }

        throw Cause.originalError(failure)
      }
    }

    // I don't really know when and how we get in this scenarios
    if (!Cause.isDie(cause) && !Cause.isFailure(cause)) {
      throw cause
    }
  }
}
