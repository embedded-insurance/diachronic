import { Effect, Layer, pipe, Runtime } from 'effect'
import {
  Def,
  Deps,
  GroupDef,
  GroupImpl,
  HTTPErrorResponse,
  HTTPInput,
  HTTPInputSchema,
  HTTPMethod,
  HTTPServerConfig,
  HTTPSuccessResponse,
  JSONResponseType,
  RouteImpl,
  RuntimeDeps,
  ServerConfig,
} from './types'
import Fastify, { FastifyReply, FastifyRequest } from 'fastify'
import * as S from '@effect/schema/Schema'

export const Response = <Status extends number, Body>(args: {
  status: Status
  body: Body
  headers?: Record<string, any>
}) => ({
  ...args,
  _tag: 'diachronic.http.response' as const,
})
export const BadRequest = (data?: any, headers?: Record<string, any>) =>
  Response({
    status: 400,
    body: data,
    headers,
  })
export type BadRequest<Data = any, Headers = any> = {
  _tag: 'HTTPResponse'
  status: 400
  body?: Data
  headers?: Headers
}
export const NotFound = (data?: any, headers?: Record<string, any>) =>
  Response({
    status: 404,
    body: data,
    headers,
  })
export const InternalServerError = (
  data?: any,
  headers?: Record<string, any>
) =>
  Response({
    status: 500,
    body: data,
    headers,
  })

export type Success<Data = any, Headers = any> = {
  _tag: 'diachronic.http.response'
  status: 200
  body?: Data
  headers?: Headers
}
export const Success = <Data, Headers extends Record<string, any>>(
  data: Data,
  headers?: Headers
) =>
  Response({
    status: 200,
    body: data,
    headers,
  })

export const isSuccessHTTPResponse = (
  response: HTTPErrorResponse | HTTPSuccessResponse
): response is HTTPSuccessResponse => response.status < 400

export const isHTTPErrorResponse = (
  response: HTTPErrorResponse | HTTPSuccessResponse
): response is HTTPErrorResponse => response.status >= 400

export const makeRequestParser = <const A extends Def>(def: A) =>
  pipe(def['diachronic.http'].request, (spec) => {
    const { type, ...ks } = spec
    return S.Struct(ks) as unknown as HTTPInputSchema<A['diachronic.http']>;
  })

/**
 * Returns a map of parser, inner function and HTTP handler according to the spec
 * @param def
 * @param fn
 */
export const implement = <const A extends Def, R>(
  def: A,
  fn: (
    args: HTTPInput<A['diachronic.http']>,
    req: FastifyRequest,
    res: FastifyReply
  ) => Effect.Effect<JSONResponseType<A>, HTTPErrorResponse, R>
): RouteImpl<A, R> => {
  const reqSpec = makeRequestParser(def)
  const method = def['diachronic.http'].method
  const path = def['diachronic.http'].path
  return {
    def,
    fn,
    parser: reqSpec as unknown as HTTPInputSchema<A['diachronic.http']>,
    handler: (req: FastifyRequest, res: FastifyReply) =>
      pipe(
        S.decodeUnknown(reqSpec)(req, {
          errors: 'all',
          onExcessProperty: 'preserve',
        }),
        Effect.mapError((e) => BadRequest()),
        Effect.flatMap((a) =>
          fn(a as HTTPInput<A['diachronic.http']>, req, res)
        ),
        Effect.withLogSpan(`${method} ${path}`)
      ),
  }
}

// todo. this isn't ready yet...we just need to map each v in k with implement
// and have the types preserved
export const implementGroup = <
  Sch extends GroupDef,
  R,
  Impl extends {
    [K in keyof Sch]: (
      args: HTTPInput<Sch[K]['diachronic.http']>,
      req: FastifyRequest,
      res: FastifyReply
    ) => Effect.Effect<JSONResponseType<Sch[K]>, HTTPErrorResponse, R>
  }
>(
  _sch: Sch,
  impl: Impl
) => impl

// const FastifyInstance = Context.Tag<fastify.FastifyInstance>()

export const createServer = <
  Def extends GroupDef,
  R,
  Impl extends GroupImpl<Def, R>,
  RT extends Runtime.Runtime<Deps<R, Impl>>
>(
  groupDef: Def,
  impl: Impl,
  runtime: RT,
  config?: HTTPServerConfig
) => {
  const server = Fastify()
  const runPromise = Runtime.runPromise(runtime)
  Object.entries(groupDef).forEach(([name, fn]) => {
    const spec = fn['diachronic.http']
    const method = spec.method.toLowerCase() as Lowercase<HTTPMethod>

    server[method](spec.path, (req, res) => {
      const handler = impl[name as keyof Impl]
      if (!handler) {
        return res.status(404).send()
      }
      return pipe(
        handler(
          // @ts-expect-error
          req.body,
          req,
          res
        ),
        Effect.provide(Layer.succeed(ServerConfig, config || ({} as any))),
        // @ts-expect-error wrong
        runPromise
      )
    })
  })
  return {
    server,
    handle: (
      method: 'get',
      path: string,
      f: (
        req: FastifyRequest,
        res: FastifyReply
      ) => Effect.Effect<HTTPSuccessResponse, HTTPErrorResponse, R>
    ) => {
      server[method](path, (req, res) =>
        pipe(
          f(req, res),
          Effect.provide(Layer.succeed(ServerConfig, config || ({} as any))),
          Effect.matchEffect({
            onSuccess: (a) =>
              Effect.try(() =>
                res
                  .status(a.status)
                  .headers(a.headers || {})
                  .send(a.body)
              ),
            onFailure: (e) =>
              Effect.try(() =>
                res
                  .status(e.status)
                  .headers(e.headers || {})
                  .send(e.body)
              ),
          }),
          Effect.withLogSpan(`${method} ${path}`),
          // @ts-expect-error
          runPromise
        )
      )
    },
  };
}

export const createServer2 = <
  RT extends Runtime.Runtime<any>,
  Config extends any
>(
  runtime: RT,
  config: Config
) => {
  const app = Fastify()
  app.register(
    (router, _opts) => {
      // router.register()
      // server.get()
    },
    { prefix: '/foo' }
  )
  const runPromise = Runtime.runPromise(runtime)
  return {
    app,
    handle: (
      method: 'get' | 'post' | 'patch',
      path: string,
      f: (
        req: FastifyRequest,
        res: FastifyReply
      ) => Effect.Effect<
        HTTPSuccessResponse,
        HTTPErrorResponse,
        RuntimeDeps<RT>
      >
    ) => {
      app[method](path, (req, res) =>
        pipe(
          f(req, res),
          Effect.provide(Layer.succeed(ServerConfig, config || ({} as any))),
          Effect.matchEffect({
            onSuccess: (a) =>
              Effect.try(() =>
                res
                  .status(a.status)
                  .headers(a.headers || {})
                  .send(a.body)
              ),
            onFailure: (e) =>
              Effect.try(() =>
                res
                  .status(e.status)
                  .headers(e.headers || {})
                  .send(e.body)
              ),
          }),
          Effect.withLogSpan(`${method} ${path}`),
          runPromise
        )
      )
    },
  };
}
