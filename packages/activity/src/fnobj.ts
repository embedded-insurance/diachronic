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
      input: S.Schema.Type<Schema['input']>
    ) => Effect.Effect<
      S.Schema.Type<Schema['output']>,
      S.Schema.Type<Schema['error']>,
      R
    >
  ): (
    self: Schema
  ) => { 'diachronic.meta': Schema } & ((
    input: S.Schema.Type<Schema['input']>
  ) => Effect.Effect<
    S.Schema.Type<Schema['output']>,
    S.Schema.Type<Schema['error']>,
    R
  >)

  <const Schema extends EffectDef, R>(
    self: Schema,
    fn: (
      input: S.Schema.Type<Schema['input']>
    ) => Effect.Effect<
      S.Schema.Type<Schema['output']>,
      S.Schema.Type<Schema['error']>,
      R
    >
  ): { 'diachronic.meta': Schema } & ((
    input: S.Schema.Type<Schema['input']>
  ) => Effect.Effect<
    S.Schema.Type<Schema['output']>,
    S.Schema.Type<Schema['error']>,
    R
  >)
} = dual(
  2,
  <const Schema extends EffectDef, R>(
    self: Schema,
    fn: (
      input: S.Schema.Type<Schema['input']>
    ) => Effect.Effect<
      S.Schema.Type<Schema['output']>,
      S.Schema.Type<Schema['error']>,
      R
    >
  ): { 'diachronic.meta': Schema } & ((
    input: S.Schema.Type<Schema['input']>
  ) => Effect.Effect<
    S.Schema.Type<Schema['output']>,
    S.Schema.Type<Schema['error']>,
    R
  >) => {
    ;(fn as any)['diachronic.meta'] = self as any
    return fn as EffectImpl<Schema, R> &
      Readonly<{ 'diachronic.meta': Readonly<Schema> }>
  }
)
