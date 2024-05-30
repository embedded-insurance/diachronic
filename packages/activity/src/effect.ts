import { Effect, Runtime } from 'effect'
import { EffectDef, EffectImpl, InputType } from './single'
import * as S from '@effect/schema/Schema'
import { pipe } from 'effect/Function'
import { ArrayFormatter, ParseResult } from '@effect/schema'
import * as TF from '@effect/schema/TreeFormatter'
import { ParseOptions } from '@effect/schema/AST'
import { EffectsDef } from './basics'

const ParseError = S.Struct({
  _tag: S.Literal('ParseError'),
  errors: S.NonEmptyArray(S.Any),
}) //as S.Schema<never,ParseResult.ParseIssue[], ParseResult.ParseIssue[]>

type SchemaError = {
  _tag: ParseResult.ParseError['_tag']
  errors: ParseResult.ParseIssue
}
export const isSchemaError = (x: unknown): x is SchemaError =>
  S.is(ParseError)(x)

export const formatSchemaErrors = (a: SchemaError) =>
  TF.formatIssueSync(a.errors)

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
export type CallableGroup<T extends EffectsDef, ExtraErrors = never> = {
  [K in keyof T]: (args: S.Schema.Type<T[K]['input']>) => Effect.Effect<
    S.Schema.Type<T[K]['output']>, // unknown,
    S.Schema.Type<T[K]['error']> | ExtraErrors
  >
}

const Issue = S.Struct({
  _tag: S.String,
  path: S.Array(S.Union(S.String, S.Number, S.Symbol)),
  message: S.String,
})

export class BadInput extends S.TaggedError<BadInput>()('BadInput', {
  functionName: S.String,
  value: S.Any,
  errors: S.Array(Issue),
}) {
  public message = 'Bad input'
  public nonRetryable = true
}

export class BadOutput extends S.TaggedError<BadOutput>()('BadOutput', {
  functionName: S.String,
  value: S.Any,
  errors: S.Array(Issue),
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
                  value: a,
                  errors: ArrayFormatter.formatErrorSync(error),
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
                    const errors = ArrayFormatter.formatErrorSync(e)
                    return pipe(
                      Effect.logWarning(
                        `${functionName} output failed schema validation`
                      ),
                      Effect.annotateLogs({ errors }),
                      Effect.flatMap(() =>
                        Effect.fail(
                          new BadOutput({
                            functionName,
                            value: output,
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
