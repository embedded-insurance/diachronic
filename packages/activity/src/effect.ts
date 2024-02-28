import { Effect, Runtime } from 'effect'
import { EffectDef, EffectImpl, InputType } from './single'
import * as S from '@effect/schema/Schema'
import { EffectsDef } from './basics'
import { pipe } from 'effect/Function'
import { ArrayFormatter, ParseResult } from '@effect/schema'
import * as TF from '@effect/schema/TreeFormatter'
import { ParseOptions } from '@effect/schema/AST'

const ParseError = S.struct({
  _tag: S.literal('ParseError'),
  errors: S.nonEmptyArray(S.any),
}) //as S.Schema<never,ParseResult.ParseIssue[], ParseResult.ParseIssue[]>

type SchemaError = {
  _tag: ParseResult.ParseError['_tag']
  errors: readonly [ParseResult.ParseIssue, ...ParseResult.ParseIssue[]]
}
export const isSchemaError = (x: unknown): x is SchemaError =>
  S.is(ParseError)(x)

export const formatSchemaErrors = (a: SchemaError) => TF.formatIssues(a.errors)

export const asEffect = <const A extends EffectDef, R>(
  _sch: A,
  impl: EffectImpl<A, R>
) => impl

/**
 * Converts an effect to a promise
 * @param impl
 * @param runtime
 */
export const asPromise = <
  A extends EffectDef,
  Impl extends EffectImpl<A, any>,
  RT extends Runtime.Runtime<Effect.Effect.Context<ReturnType<Impl>>>
>(
  impl: Impl,
  runtime: RT
) => {
  const runPromise = Runtime.runPromise(runtime)
  return (a: InputType<A>) => runPromise(impl(a))
}

export type EffectGroupDef = Record<string, EffectDef>

export const asEffectGroup = <
  Sch extends EffectGroupDef,
  R,
  Impl extends { [K in keyof Sch]: EffectImpl<Sch[K], R> }
>(
  _sch: Sch,
  impl: Impl
) => impl

/**
 * Represents a group of effects that may be invoked
 * as a calling interface with no dependencies required
 * Examples: rpc/http clients, scheduleActivity
 */
export type CallableGroup<T extends EffectsDef> = {
  [K in keyof T]: (args: S.Schema.To<T[K]['input']>) => Effect.Effect<
    never,
    // unknown,
    S.Schema.To<T[K]['error']>,
    S.Schema.To<T[K]['output']>
  >
}

const Issue = S.struct({
  _tag: S.string,
  path: S.array(S.union(S.string, S.number, S.symbol)),
  message: S.string,
})

export class BadInput extends S.TaggedError<BadInput>()('BadInput', {
  functionName: S.string,
  errors: S.array(Issue),
}) {
  public message = 'Bad input'
  public nonRetryable = true
}

export class BadOutput extends S.TaggedError<BadOutput>()('BadOutput', {
  functionName: S.string,
  errors: S.array(Issue),
}) {
  public message = 'Bad output'
  public nonRetryable = true
}

/**
 * Wraps each function in the group with calls to @effect/schema decode
 * such that all inputs to the function and the success and error values it returns
 * are checked at runtime according to the provided schema
 * @param sch
 * @param options
 */
export const addGroupDecoder = <
  Sch extends EffectGroupDef,
  Impl extends { [K in keyof Sch]: EffectImpl<Sch[K], any> }
>(
  sch: Sch,
  options?: ParseOptions
) => {
  const opts: ParseOptions = {
    errors: options?.errors || 'all',
    onExcessProperty: options?.onExcessProperty || 'preserve',
  }
  return (impl: Impl) =>
    Object.fromEntries(
      Object.entries(impl).map(([functionName, f]) => [
        functionName,
        (a: any) =>
          pipe(
            S.decode(sch[functionName].input)(a, opts),
            Effect.catchTag('ParseError', (error) =>
              Effect.fail(
                new BadInput({
                  functionName,
                  errors: ArrayFormatter.formatError(error),
                })
              )
            ),
            Effect.tap(() => Effect.logDebug(`Calling ${functionName}`)),
            Effect.flatMap(f),
            Effect.matchCauseEffect({
              onSuccess: (output) =>
                pipe(
                  S.decode(sch[functionName].output)(output, opts),
                  Effect.catchTag('ParseError', (e) => {
                    const errors = ArrayFormatter.formatError(e)
                    return pipe(
                      Effect.logWarning(
                        `${functionName} output failed schema validation`
                      ),
                      Effect.annotateLogs({ errors }),
                      Effect.flatMap(() =>
                        Effect.fail(
                          new BadOutput({
                            functionName,
                            errors,
                          })
                        )
                      )
                    )
                  })
                ),
              onFailure: (failure) =>
                pipe(
                  Effect.logDebug(`${functionName} returned an error`, failure),
                  Effect.flatMap(() =>
                    isSchemaError(failure)
                      ? Effect.fail(formatSchemaErrors(failure))
                      : pipe(
                          S.decode(sch[functionName].error)(failure, opts),
                          Effect.matchCauseEffect({
                            onSuccess: (decoded) => Effect.fail(decoded),
                            onFailure: (schemaError) =>
                              pipe(
                                Effect.logWarning(
                                  'Function returned error that violates schema',
                                  schemaError
                                ),
                                Effect.flatMap(() => Effect.fail(failure))
                              ),
                          })
                        )
                  )
                ),
            })
          ),
      ])
    ) as Impl
}
