import * as S from '@effect/schema/Schema'
import { Context, Effect, Layer } from 'effect'
import { pipe } from 'effect/Function'
import { withh, wrap } from '../src/validation'
import { def } from '../src/single'
import { asAnnotatedEffect, implement } from '../src/fnobj'

interface MyDep1 {
  mydep1: string
}

const MyDep1 = Context.Tag<MyDep1>()

interface MyDep2 {
  mydep2: string
}

const MyDep2 = Context.Tag<MyDep2>()

test('should work', () => {
  const someFn = def({
    name: 'hi',
    input: S.struct({ a: S.string }),
    output: S.literal('output'),
    error: S.literal('error'),
  })

  const ef = asAnnotatedEffect(someFn, (a) =>
    Effect.flatMap(MyDep1, (dep) =>
      Effect.succeed(a.a === 'output' ? a.a : ('output' as const))
    )
  )

  const ok3 = withh(ef)(
    (originalFn) => (input) =>
      Effect.flatMap(MyDep2, (dep) => originalFn(input))
  )

  const v = pipe(
    ok3({ a: 'ok' }),
    Effect.provide(Layer.succeed(MyDep1, {} as MyDep1)),
    Effect.provide(Layer.succeed(MyDep2, {} as MyDep2)),
    Effect.runSync
  )

  // @ts-expect-error
  const name = ok3['diachronic.meta'].name === 'hello'

  expect(ok3['diachronic.meta'].name).toEqual('hi')

  expect(v).toEqual('output')
})

test('implement / dual', () => {
  const schema = def({
    name: 'hi',
    input: S.struct({ a: S.string }),
    output: S.literal('output'),
    error: S.literal('error'),
  })
  const myimpl = pipe(
    schema,
    implement((a) => Effect.succeed('output' as const)),
    wrap((f) => (a) => f(a)), // identity
    wrap((f) => (a) => f(a)), // identity again...
    wrap((fn) => {
      const validateInput = (x: any) =>
        S.decode(fn['diachronic.meta'].input)(x, { errors: 'all' })
      const validateOutput = (x: any) =>
        S.decode(fn['diachronic.meta'].output)(x, { errors: 'all' })
      const validateError = (x: any) =>
        S.decode(fn['diachronic.meta'].error)(x, { errors: 'all' })
      return (input) =>
        pipe(
          validateInput(input),
          Effect.flatMap(fn),
          Effect.matchEffect({
            onSuccess: (a) => validateOutput(a),
            onFailure: (a) =>
              pipe(
                validateError(a),
                Effect.matchEffect({
                  onSuccess: (a) => Effect.fail(a),
                  onFailure: (a) => Effect.fail(a),
                })
              ),
          })
        )
    })
    // wrap(
    //   (fn) => (input) =>
    //     fn['diachronic.meta'].name === 'hi'
    //       ? Effect.succeed('output' as const)
    //       : Effect.fail('error' as const),
    // )
  )
})

// todo. wrap(validateInput), wrap(validateOutput) ...
// type Middleware<A extends EffectDef> = (
//   f: (a: Input<A>) => any
// ) => (a: any) => any
// const validateInput: Middleware<EffectDef> = (f) => (a) => f(a)
