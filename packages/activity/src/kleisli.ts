// @ts-nocheck
import { Effect } from 'effect'
import * as S from '@effect/schema/Schema'
import { pipe } from 'effect/Function'

interface Kleisli<A, R, E, B> {
  (a: A): Effect.Effect<R, E, B>
}

const map =
  <R1, E1, A, B, R2, E2, C>(
    f: (x: Kleisli<A, R1, E1, B>) => Kleisli<A, R1 | R2, E1 | E2, C>
  ) =>
  (self: Kleisli<A, R1, E1, B>) =>
    f(self)

const map2 =
  <R1, E1, A, B, R2, E2, C>(
    f: <X1, X2, X3, X4, X extends Kleisli<any, X2, any, any>>(
      x: X
    ) => Kleisli<A, X2, E1 | E2, C>
  ) =>
  (self: Kleisli<A, R1, E1, B>) =>
    f(self)
type KInput<T> = T extends Kleisli<infer A, infer R, infer E, infer B>
  ? A
  : never
type KCtx<T> = T extends Kleisli<infer A, infer R, infer E, infer B> ? R : never
type KOutput<T> = T extends Kleisli<infer A, infer R, infer E, infer B>
  ? E
  : never
type KError<T> = T extends Kleisli<infer A, infer R, infer E, infer B>
  ? B
  : never
const map3 =
  <A1, R1, E1, B1, A2, R2, E2, B2>(
    f: (x: Kleisli<A1, R1, E1, B1>) => Kleisli<A1, R2, E2, B2>
  ) =>
  <R3, A3, Self extends Kleisli<any, any, E1, B1>>(
    self: Parameters<typeof f>[0] //<A, B, C extends any>(a: any) => Effect.Effect<A, B, C>
  ) =>
    f(self) as (i: Parameters<typeof self>[0]) => any

const businessFn = (_input: { a: string }) =>
  Effect.succeed({ output: 'output' })

// Don't know how to get this to work without explicit any annotations
const validation = map(
  (f: any) => (x: any) =>
    Effect.flatMap(f(x), (result) =>
      S.decode(S.struct({ output: S.string }))(result as any)
    )
)
const validation2 = map2(
  (f) => (x: any) =>
    Effect.flatMap(f(x), (result) =>
      S.decode(S.struct({ output: S.string }))(result as any)
    )
)

const validation3 = map3(
  (f) => (x) =>
    Effect.flatMap(f(x), (result) =>
      S.decode(S.struct({ output: S.string }))(result as any)
    )
)
const test =
  () =>
  <A, B>(f: (x: A) => B) =>
  (y: A) =>
    f(y)

const tt = pipe(businessFn, test(), test(), test())
const testEff =
  <D>(d: D) =>
  <A, B>(f: (x: A) => B) =>
  (y: A) =>
    Effect.flatMap(
      f(y) as Effect.Effect<any, any, any>,
      (a) => a as any
    ) as Effect.Effect<
      D | (B extends Effect.Effect<infer C, any, any> ? C : never),
      D | (B extends Effect.Effect<any, infer E, any> ? E : never),
      D | (B extends Effect.Effect<any, any, infer O> ? O : never)
    >

const tt2 = pipe(
  businessFn,
  testEff({ wut: 'ok' }),
  testEff({ wut: 'ok' }),
  testEff({ wut: 'ok' })
)
tt2({ a: 'ok' })

const createTestEff2 =
  <D>(d: D) =>
  <A, B>(f: (x: A) => B) =>
  (y: A) =>
    Effect.flatMap(
      f(y) as Effect.Effect<any, any, any>,
      (a) => a as any
    ) as Effect.Effect<
      B extends Effect.Effect<infer C, any, any> ? C : never,
      B extends Effect.Effect<any, infer E, any> ? E : never,
      (B extends Effect.Effect<any, any, infer O> ? O : never) | true
    >

const inst = pipe(createTestEff2({ cr: true }), (a) => (b: any) => a(b))
const tt3 = pipe(
  businessFn,
  // inst,
  createTestEff2({ wut: 'ok' }),
  createTestEff2({ wut: 'ok' }),
  createTestEff2({ wut: 'ok' })
)
tt2({ a: 'ok' })

const wrapped3 = pipe(
  businessFn,
  validation3
  // This works
  // map(
  //   (f) => (x) =>
  //     Effect.flatMap(f(x), (result) =>
  //       S.decode(S.struct({ output: S.string }))(result)
  //     )
  // )
)
const res3 = Effect.runSync(wrapped3({ a: 'ok' }))

const wrapped2 = pipe(
  businessFn,
  validation2
  // This works
  // map(
  //   (f) => (x) =>
  //     Effect.flatMap(f(x), (result) =>
  //       S.decode(S.struct({ output: S.string }))(result)
  //     )
  // )
)
const res2 = Effect.runSync(wrapped2({ a: 'ok' }))

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
