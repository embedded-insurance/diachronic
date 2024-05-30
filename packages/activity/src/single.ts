import * as S from '@effect/schema/Schema'
import { Effect } from 'effect'

/**
 * Represents an effect as data
 */
export type EffectDef = {
  name: string
  input: S.Schema<any>
  output: S.Schema<any>
  error: S.Schema<any>
}

export type InputType<A extends EffectDef> = S.Schema.Type<A['input']>
export type OutputType<A extends EffectDef> = S.Schema.Type<A['output']>
export type ErrorType<A extends EffectDef> = S.Schema.Type<A['error']>

/**
 * Adds to a base definition
 */
export type EffectDefWith<T extends Readonly<Record<string, any>>> = EffectDef &
  T

export const defSchemaOne =
  <const A extends EffectDef>() =>
  <const B extends A>(a: B) =>
    a as B
export const def = defSchemaOne()

/**
 * Matches each name in schema to a function that can add an annotation
 * The resulting schema is inferred row-by-row / name-by-name
 * @param a
 * @param annotators
 */
export const annotateMethods = <
  T extends Record<string, EffectDef>,
  Annotators extends { [K in keyof T]: (args: T[K]) => any }
>(
  a: T,
  annotators: Annotators
) =>
  Object.entries(a).reduce((acc, [k, v]) => {
    // @ts-expect-error
    acc[k] = annotators[k](v)
    return acc
  }, {} as { [K in keyof T]: ReturnType<Annotators[K]> })

export type EffectImpl<Sch extends EffectDef, R> = (
  args: S.Schema.Type<Sch['input']>
) => Effect.Effect<S.Schema.Type<Sch['output']>, S.Schema.Type<Sch['error']>, R>

export type AnnotatedFn<Sch extends EffectDef, R> = {
  'diachronic.meta': Sch
} & ((
  args: S.Schema.Type<Sch['input']>
) => Effect.Effect<
  S.Schema.Type<Sch['output']>,
  S.Schema.Type<Sch['error']>,
  R
>)

export const extend = <A extends EffectDef, B extends EffectDef>(
  a: A,
  b: B
): EffectDefWith<Omit<B, keyof A>> => ({
  ...a,
  ...b,
})

export const defExtension =
  <B extends EffectDef>() =>
  <A extends EffectDef>(b: B) =>
  (a: A) =>
    extend<A, B>(a, b)
