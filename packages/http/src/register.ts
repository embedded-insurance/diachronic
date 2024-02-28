import { RouteImpl } from './types'
import { FastifyInstance } from 'fastify'
import { Effect, pipe, Runtime } from 'effect'

export const register = <R, Impl extends RouteImpl<any, R>>(
  inst: FastifyInstance,
  impl: Impl,
  rt: Runtime.Runtime<R>
) => {
  const { method, path } = impl.def['diachronic.http']
  return inst.route({
    method,
    url: path,
    handler: async (req, res) => {
      const result = await pipe(
        impl.handler(req, res),
        Effect.withLogSpan(`${method} ${path}`),
        Runtime.runPromiseExit(rt)
      )

      if (res.sent) return

      if (result._tag === 'Failure') {
        if (result.cause._tag === 'Fail') {
          const { status, body, headers } = result.cause.error
          res.status(status)
          if (headers) {
            res.headers(headers)
          }
          if (body) {
            res.send(body)
          } else {
            res.send('{}')
          }
        }
      } else if (result._tag === 'Success') {
        const { status, body, headers } = result.value
        res.status(status)
        if (headers) {
          res.headers(headers)
        }
        if (body) {
          res.send(body)
        } else {
          res.send('{}')
        }
      } else {
        console.error('Handler returned unknown exit value', { result })
        res.status(500).send('{}')
      }
    },
  })
}
