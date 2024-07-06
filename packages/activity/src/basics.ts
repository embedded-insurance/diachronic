import * as S from '@effect/schema/Schema'
import { Effect, Runtime } from 'effect'
import { map } from 'effect/Record'
import * as PR from '@effect/schema/ParseResult'
import { isTagged } from 'effect/Predicate'
import { dual, pipe } from 'effect/Function'

/**
 * Represents an effect as data
 */
type EffectDef = {
  input: S.Schema<any, any>
  output: S.Schema<any, any>
  error: S.Schema<any, any>
}

/**
 * A group of named effect definitions
 */
export type EffectsDef = Record<string, EffectDef>

/**
 * Constructs a definition of named effects
 * @param schema
 */
// const declareSchema =
//   <const T extends EffectsDef>() =>
//   <A extends T>(schema: A) =>
//     schema //satisfies T

/**
 * Adds additional types/properties to a basic effect definition
 * Used to implement effect definitions in different places (http, temporal activities, etc)
 */
// type EffectsDefWith<T extends Record<string, any>> = Record<
//   string,
//   EffectDef & T
// >

// type EffectDefWith<T> = EffectDef & T

/**
 * Returns the dependencies of an implementation
 */
export type Deps<T extends Effects<EffectsDef>> = {
  [K in keyof T]: Effect.Effect.Context<ReturnType<T[K]>>
}[keyof T]

/**
 * Represents a set of Temporal activities as named effect definitions
 */
// type ActivityDef = EffectsDefWith<{
//   'temporal.activity': { name: string; defaultOptions: any }
// }>

// this does the same...not sure if it works better
// type DefWithKey<Def extends EffectsDef, K extends string, A> = {
//   [K2 in keyof Def]: Def[K2] & { [k in K]: A }
// }

// Example
// type MyDef<T extends EffectsDef> =
//   | DefWithKey<T, 'temporal.activity', { name: string; defaultOptions: any }> &
//       DefWithKey<T, 'http', { path: string; method: any }>

// type MyDef<T extends EffectsDef> = DefWithKey<
//   DefWithKey<T, 'temporal.activity', { name: string; defaultOptions: any }>,
//   'http',
//   { path: string; method: any }
// >
// type MyDef = EffectsDefWith<{
//   'temporal.activity': { name: string; defaultOptions: any }
//   http: { path: string; method: any }
// }>

// const def = declareSchema<MyDef>()({
//   notifyDevelopers: {
//     // id: 'notifyDevelopers' as const,
//     input: S.struct({ message: S.string }),
//     output: S.struct({
//       sharedProp: S.string,
//       notifyDevelopersOutputGoesHere: S.boolean,
//     }),
//     error: S.literal('i am a type 2'),
//     http: {
//       method: 'POST',
//       path: '/notifyDevelopers',
//     },
//     ['temporal.activity']: {
//       name: 'replyToSyncRequest',
//       defaultOptions: {
//         startToCloseTimeout: '10s',
//       },
//     },
//   },
//   replyToSyncRequest: {
//     // id: 'replyToSyncRequest' as const,
//     input: S.struct({ topic: S.string, payload: S.string }),
//     output: S.struct({
//       replyToSyncRequestOutputGoesHere: S.string,
//       sharedProp: S.boolean,
//     }),
//     error: S.literal('i am a type 2'),
//     http: {
//       method: 'POST',
//       path: '/replyToSyncRequest',
//     },
//     ['temporal.activity']: {
//       name: 'replyToSyncRequest',
//       defaultOptions: {
//         startToCloseTimeout: '10s',
//       },
//     },
//   },
// } as const) //satisfies MyDef<EffectsDef>
// def.notifyDevelopers.

// const withCustomAnnotations = (): Simplify<
//   MyDef<{ notifyDevelopers: EffectDef }>
// > => {
//   return {
//     notifyDevelopers: {
//       input: S.struct({ message: S.string }),
//       output: S.struct({ some: S.string, otheroutput: S.boolean }),
//       error: S.literal('i am a type 2'),
//       http: {
//         path: '/foo',
//         method: 'GET',
//       },
//       activities: {
//         activityName: 'notifyDevelopers',
//         defaultOptions: {
//           startToCloseTimeout: DEFAULT_SCHEDULE_TO_START_TIMEOUT,
//         },
//       },
//     },
//   }
// }
// const ok = withCustomAnnotations()
// ok.notifyDevelopers.http.path

// type DefMappedTo<Def extends EffectsDef, A> = {
//   [K in keyof Def]: A
// }

// type DefDefWithKey<Def extends EffectsDef, K extends string, A> = {
//   [K2 in keyof Def]: Def[K] & { [k in K]: A }
// }

// type MapDefWithKey<
//   Def extends EffectsDef,
//   K extends string,
//   A extends { [K in keyof Def]: any }
// > = {
//   [K2 in keyof Def]: Def[K2] & { [k in K]: A[K2] }
// }

// type Acts = DefWithKey<
//   typeof def,
//   'activities',
//   { activityName: string; defaultOptions: any }
// >

// const annotate = <
//   A extends EffectsDef,
//   K extends string,
//   KV extends { [K in keyof A]: Record<string, any> }
// >(
//   def: A,
//   k: K,
//   kv: KV
// ): DefWithKey<A, K, KV> =>
//   Object.entries(def).reduce(
//     (acc, [name, obj]) => ({ ...acc, [name]: { ...obj, [k]: kv[name] } }),
//     {} as DefWithKey<A, K, KV>
//   )

// const annotate = <
//   A extends EffectsDef,
//   K extends string,
// >(
//   def: A,
//   k: K,
// )=><  KV extends { [K in keyof A]: Record<string, any> }
//   >(kv:KV): DefWithKey<A, K, KV> =>
//   Object.entries(def).reduce(
//     (acc, [name, obj]) => ({ ...acc, [name]: { ...obj, [k]: kv[name] } }),
//     {} as DefWithKey<A, K, KV>
//   )

// const wa = annotate(def, 'activities')({
//   notifyDevelopers: {
//     name: 'notifyDevelopers',
//     defaultOptions: {
//       startToCloseTimeout: '',
//     },
//   },
//   replyToSyncRequest: {
//     name: 'replyToSyncRequest',
//     defaultOptions: {
//       startToCloseTimeout: '',
//     },
//   },
// })
// wa.notifyDevelopers.activities.notifyDevelopers.name

type Effects<T extends EffectsDef> = {
  [K in keyof T]: (args: S.Schema.Type<T[K]['input']>) => Effect.Effect<
    S.Schema.Type<T[K]['output']>, // unknown,
    S.Schema.Type<T[K]['error']>,
    any
  >
}

/**
 * maps everything to promises
 * @param impl
 * @param runtime
 */
const toPromises = <
  Impl extends Effects<EffectsDef>,
  R extends Runtime.Runtime<Deps<Impl>>
>(
  impl: Impl,
  runtime: R
) => {
  const runPromise = Runtime.runPromise(runtime)
  return map(impl, (f) => (a: any) => runPromise(f(a))) as {
    [K in keyof Impl]: (
      args: Parameters<Impl[K]>[0]
    ) => Promise<Effect.Effect.Success<ReturnType<Impl[K]>>>
  }
}

const isParseError = (x: unknown): x is PR.ParseError =>
  isTagged(x, 'ParseError')

type DefOf<T> = T extends Effects<infer U> ? U : never

const mapEffects = <
  Def extends EffectsDef,
  Fx extends Effects<Def>,
  F extends <K extends keyof Def, ImplSch extends { impl: Fx[K]; sch: Def[K] }>(
    { impl, sch }: ImplSch,
    k: K
  ) => (args: Parameters<Fx[K]>[0]) => Effect.Effect<any, any, any>
>(
  sch: Def,
  impl: Fx,
  f: F
  // @ts-ignore
) => map(impl, f)

const mapEffects2 = <
  Def extends EffectsDef,
  Fx extends Effects<Def>,
  Ret extends Effects<Def>,
  F extends {
    [K in keyof Def]?: (args: {
      def: Def[K]
      impl: Fx[K]
    }) => (x: Parameters<Fx[K]>[0]) => Effect.Effect<any, any, any>
  } & {
    _: (args: {
      def: Def[keyof Def]
      impl: Fx[keyof Def]
    }) => (x: any) => Effect.Effect<any, any, any>
  }
>(
  _sch: Def,
  _impl: Fx,
  f: F
) =>
  // @ts-ignore
  Object.keys(def).reduce((a, k) => {
    // @ts-ignore
    if (f[k]) {
      // @ts-ignore
      return { ...a, [k]: f[k]({ def: def[k], impl: impl[k] }) }
    }
    // @ts-ignore
    return { ...a, [k]: f['_']({ def: def[k], impl: impl[k] }) }
  }, {}) as Ret

/**
 * Validates Effects input and output
 * @param sch
 * @param impl
 */
const schemaMiddleware = <Def extends EffectsDef, Fx extends Effects<Def>>(
  sch: Def,
  impl: Fx
) => {
  const decode = (sch: S.Schema<any, any>, a: unknown) =>
    S.decode(sch)(a, { errors: 'all', onExcessProperty: 'preserve' })
  // return true

  return map(impl, (f: any, key: any) => {
    const fn = (rgs: any) =>
      pipe(
        decode(sch[key].input, rgs),
        Effect.flatMap((a) => f(a)),
        Effect.matchEffect({
          onFailure: (e: unknown) =>
            isParseError(e) ? Effect.fail(e) : decode(sch[key].error, e),
          onSuccess: (a: unknown) => decode(sch[key].output, a),
        })
      )
    Object.defineProperty(fn, 'name', { value: key })
    return fn
    // }) as typeof impl
  }) as {
    [K in keyof typeof impl]: (
      args: Parameters<(typeof impl)[K]>[0] //S.Schema.Type<Def[K]['input']>
    ) => Effect.Effect<
      Effect.Effect.Success<ReturnType<(typeof impl)[K]>>,
      Effect.Effect.Error<ReturnType<(typeof impl)[K]>> | PR.ParseError,
      Effect.Effect.Context<ReturnType<(typeof impl)[K]>>
    >
  }
}

/**
 * Constructs a handler for a method
 *
 * @example
 * ```typescript
 * const quote = pipe(
 *   QuotingActivitiesSchema,
 *   handle('quote', (a) =>
 *     Effect.flatMap(HTTPClient, (fetch) =>
 *       Effect.succeed({ quote_id: JSON.stringify([a.email, a.state, a.zip]) })
 *     )
 *   )
 * )
 * const quote = handle(QuotingActivitiesSchema, 'quote', (a) =>
 *   Effect.flatMap(HTTPClient, (fetch) =>
 *     Effect.succeed({ quote_id: JSON.stringify([a.email, a.state, a.zip]) })
 *   )
 * )
 * ```
 */
export const handle: {
  <Schema extends EffectsDef, K extends keyof Schema, R>(
    k: K,
    fn: (
      input: S.Schema.Type<Schema[K]['input']>
    ) => Effect.Effect<
      S.Schema.Type<Schema[K]['output']>,
      S.Schema.Type<Schema[K]['error']>,
      R
    >
  ): (
    self: Schema
  ) => (
    input: S.Schema.Type<Schema[K]['input']>
  ) => Effect.Effect<
    S.Schema.Type<Schema[K]['output']>,
    S.Schema.Type<Schema[K]['error']>,
    R
  >
  <Schema extends EffectsDef, K extends keyof Schema, R>(
    self: Schema,
    k: K,
    fn: (
      input: S.Schema.Type<Schema[K]['input']>
    ) => Effect.Effect<
      S.Schema.Type<Schema[K]['output']>,
      S.Schema.Type<Schema[K]['error']>,
      R
    >
  ): (
    input: S.Schema.Type<Schema[K]['input']>
  ) => Effect.Effect<
    S.Schema.Type<Schema[K]['output']>,
    S.Schema.Type<Schema[K]['error']>,
    R
  >
} = dual(
  3,
  <Schema extends EffectsDef, K extends keyof Schema, R>(
    self: Schema,
    k: K,
    fn: (
      input: S.Schema.Type<Schema[K]['input']>
    ) => Effect.Effect<
      S.Schema.Type<Schema[K]['output']>,
      S.Schema.Type<Schema[K]['error']>,
      R
    >
  ): ((
    input: S.Schema.Type<Schema[K]['input']>
  ) => Effect.Effect<
    S.Schema.Type<Schema[K]['output']>,
    S.Schema.Type<Schema[K]['error']>,
    R
  >) => {
    return fn as (
      input: S.Schema.Type<Schema[K]['input']>
    ) => Effect.Effect<
      S.Schema.Type<Schema[K]['output']>,
      S.Schema.Type<Schema[K]['error']>,
      R
    >
  }
)
