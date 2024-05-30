import { defSchemaOne, EffectDef, EffectDefWith } from './single'
import { asEffect, asEffectGroup } from './effect'
import { defSchema } from './multi'
import * as S from '@effect/schema/Schema'
import { Effect } from 'effect'

const key = 'diachronic.cli' as const
type Key = typeof key

type Config = {
  name?: string
  description?: string
  path?: readonly string[]
}
export type CLIDef = EffectDefWith<{
  [key]: Config
}>
export type CLIGroupDef = Record<string, CLIDef>
export type CLIGroup<T extends CLIGroupDef> = {
  [K in keyof T]: (args: S.Schema.Type<T[K]['input']>) => Effect.Effect<
    S.Schema.Type<T[K]['output']>, // unknown,
    S.Schema.Type<T[K]['error']>
  >
}

/**
 * Makes a CLI command definition
 */
export const def = defSchemaOne<CLIDef>()

export const defGroup = defSchema<CLIDef>()

const createExtension =
  <T, const K extends string>(k: K) =>
  (f: <const Def extends EffectDef>(a: Def) => T) =>
  <const Def extends EffectDef>(a: Def) =>
    ({
      ...a,
      [k]: f(a),
    } as const as Def & { [K in typeof k]: T })

export const addCLIDef = createExtension<Config, Key>(key)

export const implement = asEffect

export const implementGroup = asEffectGroup

export type GroupDef = Record<string, CLIDef>
