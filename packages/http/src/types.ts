import { Context, Effect, Runtime } from 'effect'
import {
  defSchemaOne,
  EffectDef,
  EffectDefWith,
} from '@diachronic/activity/single'
import { defSchema } from '@diachronic/activity/multi'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { Simplify } from 'effect/Types'
import * as S from '@effect/schema/Schema'

export const key = 'diachronic.http' as const
export type Key = typeof key

export type HTTPMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'PATCH'
  | 'HEAD'
  | 'OPTIONS'

export type HTTPConfig = {
  name?: string
  serverName?: string
  path: string
  method: HTTPMethod
  request: {
    type: 'json'
    headers?: S.Schema<any>
    query?: S.Schema<any>
    params?: S.Schema<any>
    body?: S.Schema<any>
  }
  response?: {
    json?: ReadonlyArray<JSONResponseSpec>
  }
}

export type Def = EffectDefWith<{
  [key]: HTTPConfig
}>

/**
 * Represents a function with an HTTP interface as data
 */
export const def = defSchemaOne<Def>()

/**
 * Derive an HTTP def from an existing Effect def
 * @param def
 * @param fn
 */
export const fromDef = <A extends EffectDef>(
  def: A,
  fn: (def: A) => HTTPConfig
): Def => ({
  ...def,
  [key]: fn(def),
})

export const defGroup = defSchema<Def>()

export type JSONResponseSpec = {
  status: S.Schema<any>
  body: S.Schema<any>
}
// I don't know how typescript wants us to express this...
export type JSONResponseType<A extends Def> =
  A['diachronic.http']['response'] extends {
    json: readonly [
      t1?: infer T1,
      t2?: infer T2,
      t3?: infer T3,
      t4?: infer T4,
      t5?: infer T5
    ]
  }
    ?
        | (T1 extends JSONResponseSpec
            ? {
                _tag: 'diachronic.http.response'
                status: S.Schema.Type<T1['status']>
                headers?: Record<string, any>
                body: S.Schema.Type<T1['body']>
              }
            : never)
        | (T2 extends JSONResponseSpec
            ? {
                _tag: 'diachronic.http.response'
                status: S.Schema.Type<T2['status']>
                headers?: Record<string, any>
                body: S.Schema.Type<T2['body']>
              }
            : never)
        | (T3 extends JSONResponseSpec
            ? {
                _tag: 'diachronic.http.response'
                status: S.Schema.Type<T3['status']>
                headers?: Record<string, any>
                body: S.Schema.Type<T3['body']>
              }
            : never)
        | (T4 extends JSONResponseSpec
            ? {
                _tag: 'diachronic.http.response'
                status: S.Schema.Type<T4['status']>
                headers?: Record<string, any>
                body: S.Schema.Type<T4['body']>
              }
            : never)
        | (T5 extends JSONResponseSpec
            ? {
                _tag: 'diachronic.http.response'
                status: S.Schema.Type<T5['status']>
                headers?: Record<string, any>
                body: S.Schema.Type<T5['body']>
              }
            : never)
    : never

export type HTTPServerConfig = {
  default200Response: {
    headers?: Record<string, any>
  }
  default500Response: {
    headers?: Record<string, any>
    body?: any
  }
}

export type HTTPErrorResponse = {
  _tag: 'diachronic.http.response'
  status: 400 | 500 | number
  body?: any
  headers?: Record<string, any>
}

export type HTTPSuccessResponse = {
  _tag: 'diachronic.http.response'
  status: 200 | number
  body?: any
  headers?: Record<string, any>
}

export const ServerConfig = Context.GenericTag<HTTPServerConfig>(
  '@services/ServerConfig'
)

export type Handler<A extends Def, R> = (
  args: HTTPInput<A['diachronic.http']>,
  req: FastifyRequest,
  res: FastifyReply
) => Effect.Effect<JSONResponseType<A>, HTTPErrorResponse, R>
export type HTTPHandler<A extends Def, R> = (
  req: FastifyRequest,
  res: FastifyReply
) => Effect.Effect<JSONResponseType<A>, HTTPErrorResponse, R>

export type RouteImpl<A extends Def, R> = {
  def: A
  parser: HTTPInputSchema<A['diachronic.http']>
  fn: Handler<A, R>
  handler: HTTPHandler<A, R>
}

export type HTTPInput<A extends HTTPConfig> =
  A['request']['type'] extends 'json'
    ? {
        [K in Exclude<keyof A['request'], 'type'>]: S.Schema.Type<
          A['request'][K]
        >
      }
    : never

export type HTTPInputSchema<A extends HTTPConfig> =
  A['request']['type'] extends 'json'
    ? S.Struct<{
        [K in Exclude<
          keyof A['request'],
          'type'
        >]: A['request'][K] extends S.Schema<any, any, any>
          ? A['request'][K]
          : never
      }>
    : never

export type GroupDef = Record<
  string,
  EffectDefWith<{
    [key]: HTTPConfig
  }>
>

export type GroupImpl<Sch extends GroupDef, R> = {
  [K in keyof Sch]: (
    args: S.Schema.Type<Sch[K]['input']>,
    req: FastifyRequest,
    res: FastifyReply
  ) => Effect.Effect<
    S.Schema.Type<Sch[K]['output']> | JSONResponseType<Sch[K]>,
    S.Schema.Type<Sch[K]['error']>,
    R
  >
}
/**
 * Returns the dependencies of an implementation
 */
export type Deps<R, T extends GroupImpl<GroupDef, R>> = Simplify<
  {
    [K in keyof T]: Effect.Effect.Context<ReturnType<T[K]>>
  }[keyof T]
>

export type RuntimeDeps<T> = T extends Runtime.Runtime<infer R> ? R : never
