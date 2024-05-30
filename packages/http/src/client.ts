import { Effect, pipe } from 'effect'
import * as S from '@effect/schema/Schema'
import {
  Fetch,
  ErrorResponse,
  FetchError,
  InvalidURL,
} from '@effect-use/http-client'
import { ParseError } from '@effect/schema/ParseResult'
import { isRecord } from 'effect/Predicate'
import { GroupDef } from './types'

export const isSchemaError = (e: any): e is ParseError =>
  isRecord(e) && e._tag === 'ParseError'

export const validateURL = (input: string): Effect.Effect<URL, InvalidURL> =>
  pipe(
    Effect.try(() => new URL(input)),
    Effect.mapError(
      (e) =>
        new InvalidURL({
          input: input,
          stack: (e as Error).stack as string,
          message: (e as Error).message,
        })
    )
  )

export const client = <Def extends GroupDef>(
  groupDef: Def,
  config?: { baseURL?: string }
) =>
  Effect.map(
    Fetch,
    (fetch) =>
      Object.fromEntries(
        Object.entries(groupDef).map(([name, def]) => {
          const { path, method } = def['diachronic.http']
          const baseURL = config?.baseURL || ''
          const url = baseURL + path
          pipe(validateURL(url), Effect.runSync)
          return [
            name,
            (
              args: S.Schema.Type<typeof def.input>,
              headers?: (typeof def)['diachronic.http']['request'] extends {
                headers: S.Schema<any>
              }
                ? S.Schema.Type<
                    (typeof def)['diachronic.http']['request']['headers']
                  >
                : never
            ) => {
              return pipe(
                S.decode(def.input)(args, {
                  errors: 'all',
                  onExcessProperty: 'preserve',
                }),
                Effect.flatMap((a) => {
                  const body = JSON.stringify(a)
                  return Effect.tryPromise(() =>
                    fetch(url, { method, headers, body })
                  )
                }),
                Effect.mapError((e) => {
                  if (isSchemaError(e)) {
                    return e.toString()
                  }
                  return new FetchError({
                    input: {
                      baseURL,
                      path,
                      method,
                    },
                    stack: (e as Error).stack as string,
                    message: (e as Error).message,
                  })
                }),
                Effect.flatMap((response) =>
                  response.status >= 400
                    ? Effect.fail(
                        new ErrorResponse({
                          response: response,
                          statusCode: response.status,
                          message: response.statusText,
                        })
                      )
                    : Effect.succeed(response)
                ),
                Effect.tapErrorCause(Effect.logError),
                Effect.withLogSpan('@effect-use/http-client')
              )
            },
          ] as const
        })
      ) as {
        [K in keyof Def]: (
          args: S.Schema.Type<Def[K]['input']>,
          headers?: Def[K]['diachronic.http']['request'] extends {
            headers: S.Schema<any>
          }
            ? S.Schema.Type<Def[K]['diachronic.http']['request']['headers']>
            : never
        ) => Effect.Effect<
          S.Schema.Type<Def[K]['output']>,
          InvalidURL | ParseError | S.Schema.Type<Def[K]['error']>
        >
      }
  )
