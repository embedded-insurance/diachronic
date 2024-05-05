import * as S from '@effect/schema/Schema'
import { Effect } from 'effect'

/**
 * Represents an effect as data
 */
export type EffectDef = {
  name: string
  input: S.Schema<never, any>
  output: S.Schema<never, any>
  error: S.Schema<never, any>
}

export type InputType<A extends EffectDef> = S.Schema.To<A['input']>
export type OutputType<A extends EffectDef> = S.Schema.To<A['output']>
export type ErrorType<A extends EffectDef> = S.Schema.To<A['error']>

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
  args: S.Schema.To<Sch['input']>
) => Effect.Effect<R, S.Schema.To<Sch['error']>, S.Schema.To<Sch['output']>>

export type AnnotatedFn<Sch extends EffectDef, R> = {
  'diachronic.meta': Sch
} & ((
  args: S.Schema.To<Sch['input']>
) => Effect.Effect<R, S.Schema.To<Sch['error']>, S.Schema.To<Sch['output']>>)

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
