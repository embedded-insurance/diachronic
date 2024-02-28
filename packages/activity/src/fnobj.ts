import { EffectDef, EffectImpl } from './single'
import * as S from '@effect/schema/Schema'
import { Effect } from 'effect'
import { dual } from 'effect/Function'

// TODO. remove in favor of `implement` once fully tested
export const asAnnotatedEffect = <const A extends EffectDef, R>(
  sch: A,
  impl: EffectImpl<A, R>
) => {
  const fn = impl as any
  fn['diachronic.meta'] = sch
  return fn as EffectImpl<A, R> & Readonly<{ 'diachronic.meta': Readonly<A> }>
}

export const implement: {
  <const Schema extends EffectDef, R>(
    fn: (
      input: S.Schema.To<Schema['input']>
    ) => Effect.Effect<
      R,
      S.Schema.To<Schema['error']>,
      S.Schema.To<Schema['output']>
    >
  ): (
    self: Schema
  ) => { 'diachronic.meta': Schema } & ((
    input: S.Schema.To<Schema['input']>
  ) => Effect.Effect<
    R,
    S.Schema.To<Schema['error']>,
    S.Schema.To<Schema['output']>
  >)

  <const Schema extends EffectDef, R>(
    self: Schema,
    fn: (
      input: S.Schema.To<Schema['input']>
    ) => Effect.Effect<
      R,
      S.Schema.To<Schema['error']>,
      S.Schema.To<Schema['output']>
    >
  ): { 'diachronic.meta': Schema } & ((
    input: S.Schema.To<Schema['input']>
  ) => Effect.Effect<
    R,
    S.Schema.To<Schema['error']>,
    S.Schema.To<Schema['output']>
  >)
} = dual(
  2,
  <const Schema extends EffectDef, R>(
    self: Schema,
    fn: (
      input: S.Schema.To<Schema['input']>
    ) => Effect.Effect<
      R,
      S.Schema.To<Schema['error']>,
      S.Schema.To<Schema['output']>
    >
  ): { 'diachronic.meta': Schema } & ((
    input: S.Schema.To<Schema['input']>
  ) => Effect.Effect<
    R,
    S.Schema.To<Schema['error']>,
    S.Schema.To<Schema['output']>
  >) => {
    ;(fn as any)['diachronic.meta'] = self as any
    return fn as EffectImpl<Schema, R> &
      Readonly<{ 'diachronic.meta': Readonly<Schema> }>
  }
)
