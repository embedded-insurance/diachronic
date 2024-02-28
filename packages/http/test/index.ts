import * as S from '@effect/schema/Schema'
import { Console, Context, Effect, Layer, pipe } from 'effect'
import Fastify from 'fastify'
import { register } from '../src/register'
import {
  implement,
  InternalServerError,
  makeRequestParser,
  Success,
} from '../src'

const Postgres = Context.Tag<{
  getData: (args: any) => Effect.Effect<never, unknown, unknown>
}>()

const TestFail = Layer.succeed(
  Postgres,
  Postgres.of({ getData: (a) => Effect.fail(a) })
)
const TestSucceed = Layer.succeed(
  Postgres,
  Postgres.of({ getData: (a) => Effect.succeed(a) })
)
test('simple 2', async () => {
  const defs = {
    getData: {
      name: 'getData',
      input: S.any,
      output: S.any,
      error: S.any,
      'diachronic.http': {
        method: 'GET',
        path: '/data/:id',
        request: {
          type: 'json',
          params: S.struct({ id: S.string }),
        },
        response: {
          json: [
            {
              status: S.literal(200),
              body: S.struct({ helloWorld: S.boolean }),
            },
          ],
        },
      },
    },
  } as const

  const getData = implement(defs.getData, ({ params }) =>
    pipe(
      Console.log({ params }),
      Effect.flatMap(() =>
        Effect.flatMap(Postgres, (db) => db.getData(params.id))
      ),
      Effect.map((a) => Success({ helloWorld: true })),
      Effect.mapError(() => InternalServerError())
    )
  )

  expect(
    S.decodeSync(getData.parser)({
      params: { id: 'foo' },
    })
  ).toEqual({
    params: { id: 'foo' },
  })

  expect(
    S.decodeSync(makeRequestParser(defs.getData))({ params: { id: 'foo' } })
  ).toEqual({ params: { id: 'foo' } })

  expect(
    await pipe(
      getData.fn({ params: { id: '12' } }, {} as any, {} as any),
      Effect.provide(TestFail),
      Effect.flip,
      Effect.runPromise
    )
  ).toEqual({
    _tag: 'diachronic.http.response',
    status: 500,
  })

  expect(
    await pipe(
      getData.handler({ body: 'foobar' } as any, {} as any),
      Effect.provide(TestSucceed),
      Effect.flip,
      Effect.runPromise
    )
  ).toEqual({
    _tag: 'diachronic.http.response',
    status: 400,
  })

  const rt = pipe(TestFail, Layer.toRuntime, Effect.scoped, Effect.runSync)

  const inst = Fastify()

  try {
    register(inst, getData, rt)
    await inst.listen({ port: 3000 })
    const result = await fetch('http://localhost:3000/data/12')
    expect(result.status === 500)
    expect(await result.json()).toEqual({})
  } finally {
    await inst.close()
  }
})

test('handling success', async () => {
  const defs = {
    getData: {
      name: 'getData',
      input: S.any,
      output: S.any,
      error: S.any,
      'diachronic.http': {
        method: 'GET',
        path: '/data/:id',
        request: {
          type: 'json',
          params: S.struct({ id: S.string }),
        },
        response: {
          json: [
            {
              status: S.literal(200),
              body: S.struct({ helloWorld: S.boolean }),
            },
          ],
        },
      },
    },
  } as const

  const getData = implement(defs.getData, ({ params }) =>
    Effect.succeed(Success({ helloWorld: true }))
  )

  expect(
    await pipe(
      getData.fn({ params: { id: '12' } }, {} as any, {} as any),
      Effect.runPromise
    )
  ).toEqual({
    _tag: 'diachronic.http.response',
    body: {
      helloWorld: true,
    },
    status: 200,
  })

  expect(
    await pipe(
      getData.handler({ body: 'foobar' } as any, {} as any),
      Effect.flip,
      Effect.runPromise
    )
  ).toEqual({
    _tag: 'diachronic.http.response',
    status: 400,
  })

  const rt = Effect.runSync(Effect.runtime())

  const inst = Fastify()

  try {
    register(inst, getData, rt)
    await inst.listen({ port: 3000 })
    const result = await fetch('http://localhost:3000/data/12')
    expect(result.status === 500)
    expect(await result.json()).toEqual({ helloWorld: true })
  } finally {
    await inst.close()
  }
})
