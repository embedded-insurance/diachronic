//@ts-nocheck
import { def } from '../src/single'
import * as S from '@effect/schema/Schema'
import { pipe } from 'effect/Function'
import { implement } from '../src/fnobj'
import { Context, Effect } from 'effect'
import { validate, ValidateOptions } from '../src/validate'
import { makeWrapOther, wrap, wrapOther } from '../src/validation'
// import { isSchemaError } from '@diachronic/http/client'

interface MyDep1 {
  mydep1: string
}

const MyDep1 = Context.GenericTag<MyDep1>('@services/MyDep1')

interface MyDep2 {
  mydep2: string
}

const MyDep2 = Context.GenericTag<MyDep2>('@services/MyDep2')

describe('validate', () => {
  test('works with inline wrap', () => {
    const schema = def({
      name: 'hi',
      input: S.Struct({ a: S.String }),
      output: S.Literal('output'),
      error: S.Literal('error'),
    })

    const justimpl = pipe(
      schema,
      implement((a) => Effect.succeed('output' as const))
    )

    const myimpl = pipe(
      // schema,
      // implement((a) => Effect.succeed('output' as const)),
      justimpl,
      wrap((fn) => {
        const validateInput = (x: any) =>
          S.decode(fn['diachronic.meta'].input)(x)
        const validateOutput = (x: any) =>
          S.decode(fn['diachronic.meta'].output)(x)
        const validateError = (x: any) =>
          S.decode(fn['diachronic.meta'].error)(x)

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
      // validate()
    )

    expect(pipe(myimpl({ a: 'ok' }), Effect.runSync)).toEqual('output')
  })

  // fails
  test.skip('works with wrap defined as a variable', () => {
    const validate = wrapOther((fn) => {
      const validateInput = (x: any) => S.decode(fn['diachronic.meta'].input)(x)
      const validateOutput = (x: any) =>
        S.decode(fn['diachronic.meta'].output)(x)
      const validateError = (x: any) => S.decode(fn['diachronic.meta'].error)(x)
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

    const schema = def({
      name: 'hi',
      input: S.Struct({ a: S.String }),
      output: S.Literal('output'),
      error: S.Literal('error'),
    })

    const base = pipe(
      schema,
      implement((a) => Effect.succeed('output' as const))
    )

    const withValidation = pipe(base, validate)

    // @ts-expect-error
    withValidation({ foobar: 3 })

    const eff = withValidation({ a: 'ok' })
    pipe(eff, Effect.runSync)

    // expect(pipe(withValidation({ a: 'ok' }), Effect.runSync)).toEqual('output')

    const impl = pipe(
      schema,
      implement((a) => Effect.succeed('output' as const))
    )
    const v = makeWrapOther()((f) => (a) => f(a))

    const why = (a: any) => {
      let fn = (input: any) => a(input)
      return Object.assign(fn, { 'diachronic.meta': a['diachronic.meta'] })
    }

    const wrapped = pipe(
      (input: { a: string }) => Effect.succeed('output'),
      (fn) => {
        const validate = S.decode(S.Struct({ a: S.String }))
        return (input: { a: string }) =>
          pipe(validate(input), Effect.flatMap(fn))
      }
    )
    Effect.runSync(wrapped({ a: 'ok' }))

    pipe(
      impl,
      (a) => {
        let fn = (input: Parameters<typeof a>[0]) =>
          Effect.flatMap(MyDep1, (_) => a(input))
        return Object.assign(fn, { 'diachronic.meta': a['diachronic.meta'] })
      },
      (a) => {
        let fn = (input: Parameters<typeof a>[0]) =>
          Effect.flatMap(MyDep2, (_) => a(input))
        return Object.assign(fn, { 'diachronic.meta': a['diachronic.meta'] })
      },
      // a=>a({a:1}),
      (a) => a({ f: 1 }),
      Effect.runSync
    )
    //A extends
    // <R, E, A>(x: any) => Effect.Effect<R, E, A>
    const mwfn1 = <
      // A extends ((x: infer I) => Effect.Effect<infer R,infer E, infer O>) ? ((x: I) => Effect.Effect<R, E, O>) : never
      A
    >(
      a: A extends { 'diachronic.meta': any } & ((
        ...x: infer I
      ) => Effect.Effect<infer O, infer E, infer R>)
        ? true
        : false
    ) => {
      return a
      // let fn = (input: Parameters<typeof a>[0]) =>
      //   Effect.flatMap(MyDep1, (_) => a(input))
      // return fn as A
      // return Object.assign(fn, { 'diachronic.meta': a['diachronic.meta'] })
    }
    const mwfn2 = <
      I,
      R0,
      E0,
      A0
      // R1,E1,A1
    >(
      f: (
        a: (i: I) => Effect.Effect<A0, E0, R0>
      ) => <R1, E1, A1>(i: I) => Effect.Effect<A1, E1, R1>
    ) => {
      return f
      // let fn = (input: Parameters<typeof a>[0]) =>
      //   Effect.flatMap(MyDep1, (_) => a(input))
      // return fn as A
      // return Object.assign(fn, { 'diachronic.meta': a['diachronic.meta'] })
    }
    mwfn2((f) => (i) => f(i))
    pipe(impl, mwfn2, (a) => a({ f: 1 }), Effect.runSync)
  })
})

type EffectFn<R, E, A, I> = (i: I) => Effect.Effect<A, E, R>

type EffectFnMap = <R, E, A, I, R1, E1, A1, Self extends EffectFn<R, E, A, I>>(
  self: Self,
  f: (self: Self) => (i: I) => Effect.Effect<A1, E1, R1>
) => (i: I) => Effect.Effect<A | A1, E | E1, R | R1>

// const effectFnMap = <R, E, A, I, R1, E1, A1,
//   Self extends EffectFn<R, E, A, I>
// >(
//   self: Self,
//   f: (self: Self) => EffectFn<R1, E1, A1, I>,
// ):EffectFn<R|R1,E|E1,A|A1,I> => {
//   return f(self)
// }

type EffectFnInput<T> = T extends EffectFn<infer R, infer E, infer A, infer I>
  ? I
  : never

type EffectFnContext<T> = T extends EffectFn<infer R, infer E, infer A, infer I>
  ? R
  : never

const effectFnMap = <R, E, A, R1, E1, A1, Self extends EffectFn<R, E, A, any>>(
  f: (self: Self) => EffectFn<R1, E1, A1, EffectFnInput<Self>>,
  self: Self
): EffectFn<R | R1, E | E1, A | A1, EffectFnInput<Self>> => {
  return f(self)
}

const effectFnMap2 =
  <R, E, A, E1, A1, Self extends EffectFn<R, E, A, any>>(
    f: <R3>(self: Self) => EffectFn<
      //
      | EffectFnContext<Self>
      //
      | R
      //
      | R3,
      E1,
      A1,
      EffectFnInput<Self>
    >
  ) =>
  (
    self: Self
  ): EffectFn<
    EffectFnContext<Self> | R,
    E | E1,
    A | A1,
    EffectFnInput<Self>
  > => {
    return f(self)
  }

// const res2 = effectFnMap2((f) => (a) => f(a))((i: { f: string }) => Effect.succeed('output'))
const justathing = effectFnMap2((f) => (a) => f(a))

const res21 = pipe(
  (i: { f: string }) => Effect.succeed('output'),
  (a) => justathing(a)
  // effectFnMap2((f) => (a) => f(a))
)
Effect.runSync(res21({ f: 'ok' }))

effectFnMap(
  (f) => (a) => f(a),
  (i: { f: string }) => Effect.succeed('output')
)
Effect.flatMap((a) => a)

// type EffectFn = <R, E, A, I>(
//   f: (i: I) => Effect.Effect<R, E, A>
// ) => (i: I) => Effect.Effect<R, E, A>
const effectFn = <R, E, A, I>(f: (i: I) => Effect.Effect<A, E, R>) => f
const myfn = (input: { a: string }) => Effect.succeed('output')
const myfn2 = effectFn((a: { s: string }) => Effect.succeed('output'))
const myMap = <Fn extends EffectFn>(f: (a: Fn) => Fn) => {}
const mymiddleware = <
  Fn extends (x: any) => Effect.Effect<any, any, any>,
  Input extends Parameters<Fn>[0],
  Ret extends ReturnType<Fn>,
  // Impl extends  <R, E, A>(
  //   x: Input
  // ) => Effect.Effect<
  //   R | Effect.Effect.Context<Ret>,
  //   E | Effect.Effect.Error<Ret>,
  //   A | Effect.Effect.Success<Ret>
  // >
  Impl extends <R, E, A>(x: Input) => Effect.Effect<A, E, R>,
  // Impl extends (x: Input) => Effect.Effect<unknown, unknown, unknown>,
  RetEffect extends ReturnType<Impl>
>(
  fn: Fn
): ((x: Input) => RetEffect) => {
  //   Effect.Effect<
  //   R|Effect.Effect.Context<RetEffect> | Effect.Effect.Context<Ret>,
  //   E|Effect.Effect.Error<ReturnType<Impl>> | Effect.Effect.Error<Ret>,
  //   A|Effect.Effect.Success<ReturnType<Impl>> | Effect.Effect.Success<Ret>
  // >
  const validate = S.decode(S.Struct({ a: S.String }))
  return (input) => pipe(validate(input), Effect.flatMap(fn)) as any
}
const wrapped = pipe(myfn, mymiddleware)
Effect.runSync(wrapped({ a: 'ok' }))
