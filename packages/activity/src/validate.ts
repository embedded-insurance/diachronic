// @ts-ignore

import { AST } from '@effect/schema'
import { MakeWrap, wrap } from './validation'
import * as S from '@effect/schema/Schema'
import { flow, pipe } from 'effect/Function'
import { Effect } from 'effect'
import { isSchemaError } from './effect'

export type ValidateOptions = {
  input?: AST.ParseOptions
  output?: AST.ParseOptions
  error?: AST.ParseOptions
}
const defaults: ValidateOptions = {
  input: { errors: 'all' },
  output: { errors: 'all' },
  error: { errors: 'all' },
}
// fixme. run options conditionally & efficiently
export const validate = (options: ValidateOptions = defaults) =>
  wrap((fn) => {
    const validateInput = (x: any) =>
      S.decode(fn['diachronic.meta'].input)(x, options.input)
    const validateOutput = (x: any) =>
      S.decode(fn['diachronic.meta'].output)(x, options.output)
    const validateError = (x: any) =>
      S.decode(fn['diachronic.meta'].error)(x, options.error)

    return (input) =>
      pipe(
        validateInput(input),
        Effect.flatMap(fn),
        Effect.matchEffect({
          onSuccess: (a) => validateOutput(a),
          onFailure: (a) =>
            isSchemaError(a)
              ? Effect.fail(a)
              : pipe(
                  validateError(a),
                  Effect.matchEffect({
                    onSuccess: (a) => Effect.fail(a),
                    onFailure: (a) => Effect.fail(a),
                  })
                ),
        })
      )
  })

// interface Kleisli<A, R, E, B> {
//   (a: A): Effect.Effect<R, E, B>
// }
//
// const composeK =
//   <B, R2, E2, C>(g: Kleisli<B, R2, E2, C>) =>
//   <R1, E1, A>(f: Kleisli<A, R1, E1, B>): Kleisli<A, R1 | R2, E1 | E2, C> =>
//   (a) =>
//     Effect.flatMap(f(a), g)
//
// const f = <A>(input: A) => S.decode(S.struct({ a: S.string }))(input as any)
//
// const h = (input: any) => S.decode(S.struct({ a: S.string }))(input)
//
// const g = (input: { a: string }) => Effect.succeed('output')
//
// const wrapped = pipe(f, composeK(h), composeK(g) /* , composeK(h), ...etc.. */)
//
// Effect.runSync(wrapped({ b: 'ok' }))

const composeK0 =
  <B, R2, E2, C>(g: (b: B) => Effect.Effect<R2, E2, C>) =>
  <R1, E1, A>(
    f: (a: A) => Effect.Effect<R1, E1, B>
  ): ((a: A) => Effect.Effect<R1 | R2, E1 | E2, C>) =>
  (a) =>
    Effect.flatMap(f(a), g)

///
interface Kleisli<A, R, E, B> {
  (a: A): Effect.Effect<R, E, B>
}

const composeK =
  <B, R2, E2, C>(g: Kleisli<B, R2, E2, C>) =>
  <R1, E1, A>(f: Kleisli<A, R1, E1, B>): Kleisli<A, R1 | R2, E1 | E2, C> =>
  (a) =>
    Effect.flatMap(f(a), g)

const composerK =
  <B, R2, E2, C>(g: Kleisli<B, R2, E2, C>) =>
  <R1, E1, A>(f: Kleisli<A, R1, E1, B>): Kleisli<A, R1 | R2, E1 | E2, C> =>
  (a) =>
    Effect.flatMap(f(a), g)

// const chainK =
//   <B, R2, E2, C>(
//     f: (ma: Effect.Effect<R2, E2, B>) => Kleisli<any, any, any, any>
//   ): (<R1, E1>(
//     self: Kleisli<any, any, any, any>
//   ) => Kleisli<R1 | R2, E1 | E2, B>) =>
//   (self) =>
//     f(self)

const validateInput = S.decode(S.struct({ a: S.string })) // validation

// target
const makeValidateOutput =
  <R1, E1, A, B, R2, E2, C>(self: Kleisli<A, R1, E1, B>) =>
  (f: (x: typeof self) => Kleisli<A, R1 | R2, E1 | E2, C>) =>
    f(self)

const map =
  <R1, E1, A, B, R2, E2, C>(
    f: (x: Kleisli<A, R1, E1, B>) => Kleisli<A, R1 | R2, E1 | E2, C>
  ) =>
  (self: Kleisli<A, R1, E1, B>) =>
    f(self)

const businessFn = (_input: { a: string }) =>
  Effect.succeed({ output: 'output' })

// Don't know how to get this to work without explicit any annotations
const validation = map(
  (f: any) => (x: any) =>
    Effect.flatMap(f(x), (result) =>
      S.decode(S.struct({ output: S.string }))(result as any)
    )
)
const wrapped = pipe(
  businessFn,
  validation
  // This works
  // map(
  //   (f) => (x) =>
  //     Effect.flatMap(f(x), (result) =>
  //       S.decode(S.struct({ output: S.string }))(result)
  //     )
  // )
)

const result = pipe(wrapped({ a: 'ok' }), Effect.runSync)

///
