// @ts-nocheck
import * as PR from '@effect/schema/ParseResult'
import { isTagged } from 'effect/Predicate'
import { dual, flow, pipe } from 'effect/Function'
import * as S from '@effect/schema/Schema'
import { AnnotatedFn, EffectDef, InputType } from './single'
import { Context, Effect } from 'effect'

import { asAnnotatedEffect } from './fnobj'

export const withInputValidation = <R, Fn extends AnnotatedFn<EffectDef, R>>(
  fn: Fn
) => {
  let next = (input: InputType<Fn['diachronic.meta']>) =>
    pipe(input, S.decode(fn['diachronic.meta'].input), Effect.flatMap(fn))
  return Object.assign(next, {
    'diachronic.meta': fn['diachronic.meta'],
  }) as typeof next & {
    'diachronic.meta': Fn['diachronic.meta']
  }
}

export const withOutputValidation = <R, Fn extends AnnotatedFn<EffectDef, R>>(
  fn: Fn
) => {
  let next = (input: S.Schema.Type<Fn['diachronic.meta']['input']>) =>
    pipe(input, fn, Effect.flatMap(S.decode(fn['diachronic.meta'].output)))
  return Object.assign(next, {
    'diachronic.meta': fn['diachronic.meta'],
  }) as typeof next & {
    'diachronic.meta': Fn['diachronic.meta']
  }
}

export const withh =
  <R1, Def extends EffectDef, Base extends AnnotatedFn<Def, R1>>(base: Base) =>
  <Ret extends (input: Parameters<Base>[0]) => Effect.Effect<any, any, any>>(
    modifier: (a: Base) => Ret
  ): ((
    input: Parameters<Base>[0]
  ) => Effect.Effect<
    | Effect.Effect.Success<ReturnType<Base>>
    | Effect.Effect.Success<ReturnType<Ret>>,
    | Effect.Effect.Error<ReturnType<Base>>
    | Effect.Effect.Error<ReturnType<Ret>>,
    | Effect.Effect.Context<ReturnType<Base>>
    | Effect.Effect.Context<ReturnType<Ret>>
  >) & { 'diachronic.meta': Base['diachronic.meta'] } =>
    Object.assign(modifier(base), {
      'diachronic.meta': base['diachronic.meta'],
    })

export const wrap =
  <
    Base extends ((args: any) => Effect.Effect<any, any, any>) & {
      'diachronic.meta': any
    },
    Ret extends (
      base: Base
    ) => (input: Parameters<Base>[0]) => Effect.Effect<any, any, any>
  >(
    modifier: Ret
  ) =>
  // todo. need this signature and the one from prev commit for different composition patterns
  // <Next extends Base>
  (
    base: Base //Next extends infer U extends Base ? U : Next
  ): ((
    input: Parameters<Base>[0]
  ) => Effect.Effect<
    | Effect.Effect.Success<ReturnType<Base>>
    | Effect.Effect.Success<ReturnType<ReturnType<Ret>>>,
    | Effect.Effect.Error<ReturnType<Base>>
    | Effect.Effect.Error<ReturnType<ReturnType<Ret>>>,
    | Effect.Effect.Context<ReturnType<Base>>
    | Effect.Effect.Context<ReturnType<ReturnType<Ret>>>
  >) & { 'diachronic.meta': Base['diachronic.meta'] } =>
    Object.assign(modifier(base), {
      'diachronic.meta': base['diachronic.meta'],
    })

type Success<T extends Effect.Effect<any, any, any>> = Effect.Effect.Success<T>
type Err<T extends Effect.Effect<any, any, any>> = Effect.Effect.Error<T>
type Ctx<T extends Effect.Effect<any, any, any>> = Effect.Effect.Context<T>
export const makeWrapOther =
  <
    // R0,E0,A0,
    Base extends ((args: any) => Effect.Effect<any, any, any>) & {
      'diachronic.meta': any
    }
  >() =>
  <
    Ret extends <A, B, C>(
      base: Base
    ) => (
      input: Parameters<Base>[0]
    ) => Effect.Effect<any, any, A | Ctx<ReturnType<Base>>>
  >(
    modifier: Ret
  ) =>
  // todo. need this signature and the one from prev commit for different composition patterns
  (
    base: Base //Next extends infer U extends Base ? U : Next
  ): ((
    input: Parameters<Base>[0]
  ) => Effect.Effect<
    | Effect.Effect.Success<ReturnType<Base>>
    | Effect.Effect.Success<ReturnType<ReturnType<Ret>>>,
    | Effect.Effect.Error<ReturnType<Base>>
    | Effect.Effect.Error<ReturnType<ReturnType<Ret>>>,
    | Effect.Effect.Context<ReturnType<Base>>
    | Effect.Effect.Context<ReturnType<ReturnType<Ret>>>
  >) & { 'diachronic.meta': Base['diachronic.meta'] } =>
    Object.assign(modifier(base), {
      'diachronic.meta': base['diachronic.meta'],
    })

export const wrapOther =
  <
    Base extends ((args: any) => Effect.Effect<any, any, any>) & {
      'diachronic.meta': any
    },
    Ret extends (base: Base) => ((
      input: Parameters<Base>[0]
    ) => Effect.Effect<any, any, any>) & {
      'diachronic.meta'?: any
    }
  >(
    modifier: Ret
  ) =>
  // todo. need this signature and the one from prev commit for different composition patterns
  <Next extends Base>(
    base: Next //Next extends infer U extends Base ? U : Next
  ): ((input: Parameters<Next>[0]) => Effect.Effect<
    // | Effect.Effect.Error<ReturnType<ReturnType<Ret>>>,
    // | Effect.Effect.Success<ReturnType<ReturnType<Ret>>>
    Effect.Effect.Success<ReturnType<Next>>,
    Effect.Effect.Error<ReturnType<Next>>,
    | Effect.Effect.Context<ReturnType<Next>>
    | Effect.Effect.Context<ReturnType<ReturnType<Ret>>>
  >) & { 'diachronic.meta': Base['diachronic.meta'] } =>
    Object.assign(modifier(base), {
      'diachronic.meta': base['diachronic.meta'],
    })

export type MakeWrap<Options> = (args: Options) => <
  Base extends ((args: any) => Effect.Effect<any, any, any>) & {
    'diachronic.meta': any
  },
  Ret extends (
    base: Base
  ) => (input: Parameters<Base>[0]) => Effect.Effect<any, any, any>
>(
  modifier: Ret
) => <A extends Base>(
  base: A
) => ((
  input: Parameters<A>[0]
) => Effect.Effect<
  | Effect.Effect.Success<ReturnType<A>>
  | Effect.Effect.Success<ReturnType<ReturnType<Ret>>>,
  | Effect.Effect.Error<ReturnType<A>>
  | Effect.Effect.Error<ReturnType<ReturnType<Ret>>>,
  | Effect.Effect.Context<ReturnType<A>>
  | Effect.Effect.Context<ReturnType<ReturnType<Ret>>>
>) & { 'diachronic.meta': Base['diachronic.meta'] }

type FnObj = {
  (args: any): Effect.Effect<any, any, any>
  [k: string]: any
}

const FnObj = <
  Fn extends (args: any) => Effect.Effect<any, any, any>,
  Obj extends Record<string, any>
>(
  fn: Fn,
  obj: Obj
) => Object.assign(fn, obj)

const a = Object.assign(
  (some: { cool: 'type' }) => Effect.succeed({ cool: true } as const),
  { 'diachronic.meta': 'hi' }
)

pipe(
  a,
  wrap((f) => (a) => Effect.succeed(f['diachronic.meta'])),
  wrap((f) => (a) => Effect.succeed(f['diachronic.meta']))
)

const other =
  <
    R1,
    //
    Def extends EffectDef,
    //
    Base extends AnnotatedFn<Def, R1>
    //
  >(
    base: Base
  ) =>
  <Ret extends (input: Parameters<Base>[0]) => Effect.Effect<any, any, any>>(
    modifier: (a: Base) => Ret
  ): ((
    input: Parameters<Base>[0]
  ) => Effect.Effect<
    | Effect.Effect.Success<ReturnType<Base>>
    | Effect.Effect.Success<ReturnType<Ret>>,
    | Effect.Effect.Error<ReturnType<Base>>
    | Effect.Effect.Error<ReturnType<Ret>>,
    | Effect.Effect.Context<ReturnType<Base>>
    | Effect.Effect.Context<ReturnType<Ret>>
  >) & { 'diachronic.meta': Base['diachronic.meta'] } =>
    Object.assign(modifier(base), {
      'diachronic.meta': base['diachronic.meta'],
    })

// const shape = (f1: Function) => (f2: Function) => f2(f1)

// test
const ef = asAnnotatedEffect(
  {
    name: 'hi',
    input: S.Struct({ a: S.String }),
    output: S.Literal('output'),
    error: S.Literal('error'),
  },
  (a) =>
    Effect.flatMap(MyDep1, (dep) =>
      Effect.succeed(a.a === 'output' ? a.a : ('output' as const))
    )
)

interface MyDep2 {
  mydep2: string
}

const MyDep2 = Context.GenericTag<MyDep2>('@services/MyDep2')

interface MyDep1 {
  mydep1: string
}

const MyDep1 = Context.GenericTag<MyDep1>('@services/MyDep1')

const ok3 = pipe(ef, (a) =>
  withh(a)((f) => {
    return (input) => {
      return Effect.flatMap(MyDep2, (dep) => Effect.succeed('output' as const))
    }
  })
)

// TODO. MOVE TO TEST
// const ok2 = pipe(
//   ef,
//   (a) => {
//     return withh(a)((x) => {
//       // @ts-expect-error
//       x['diachronic.meta'].name === 'hello'
//
//       return (input) => {
//         return pipe(S.decode(x['diachronic.meta'].input)(input), Effect.flatMap(x))
//       }
//     })
//   },
//   (final) => final({ a: 'ok' }),
//   // @ts-expect-error
//   Effect.runSync
// )

const ok = pipe(
  ef,
  (a) => {
    return withh(a)((x) => {
      // @ts-expect-error
      x['diachronic.meta'].name === 'hello'
      return (z) => {
        if (z.a) {
          return Effect.succeed('output')
        } else {
          return Effect.fail('error')
        }
      }
    })
  },
  (final) => final({ a: 'ok' }),
  // @ts-expect-error
  Effect.runSync
)

const res = pipe(ef, withInputValidation, withOutputValidation, (a) => {
  // @ts-expect-error
  a['diachronic.meta'].name === 'foo'
  return a({
    // @ts-expect-error
    x: 'hi',
  })
})

const isParseError = (x: unknown): x is PR.ParseError =>
  isTagged(x, 'ParseError')

// /**
//  * Validates Effects input and output
//  * @param sch
//  * @param impl
//  */
// const schemaMiddleware = <Def extends EffectsDef, Fx extends Effects<Def>>(
//   sch: Def,
//   impl: Fx
// ) => {
//   const decode = (sch: S.Schema<any, any>, a: unknown) =>
//     S.decode(sch)(a, { errors: 'all' })
//   // return true
//
//   return map(impl, (f: any, key: any) => {
//     const fn = (rgs: any) =>
//       pipe(
//         decode(sch[key].input, rgs),
//         Effect.flatMap((a) => f(a)),
//         Effect.matchEffect({
//           onFailure: (e: unknown) =>
//             isParseError(e) ? Effect.fail(e) : decode(sch[key].error, e),
//           onSuccess: (a: unknown) => decode(sch[key].output, a),
//         })
//       )
//     Object.defineProperty(fn, 'name', { value: key })
//     return fn
//     // }) as typeof impl
//   }) as {
//     [K in keyof typeof impl]: (
//       args: Parameters<(typeof impl)[K]>[0] //S.Schema.Type<Def[K]['input']>
//     ) => Effect.Effect<
//       Effect.Effect.Context<ReturnType<(typeof impl)[K]>>,
//       Effect.Effect.Error<ReturnType<(typeof impl)[K]>> | PR.ParseError,
//       Effect.Effect.Success<ReturnType<(typeof impl)[K]>>
//     >
//   }
// }
