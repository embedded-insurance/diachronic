import { Context, Effect, Layer, Runtime } from 'effect'
import * as S from '@effect/schema/Schema'
import { pipe } from 'effect/Function'
import { MQTTClient } from '@diachronic/workflow-request-response/mqtt'
import { toMapOfPromises } from '../src/multi'
import { asEffectGroup } from '../src/effect'
import * as Activity from '../src/activity'

const sampleDef = Activity.activityDef({
  name: 'hello',
  input: S.struct({ someInput: S.string }),
  output: S.number,
  error: S.string,
  'temporal.activity': {
    defaultOptions: { activityId: 'foo' },
  },
})

const sampleGroupDef = Activity.defGroup({
  one: sampleDef,
  two: sampleDef,
})

interface MyDep {}

const MyDep = Context.Tag<MyDep>('MyDep')

describe('implement an activity', () => {
  test('with no dependencies', () => {
    const act = Activity.implement(sampleDef, (a) =>
      Effect.succeed(a.someInput.length)
    )
    try {
      act({
        // @ts-expect-error input wrong
        somInput: 'hi',
      })
    } catch (_) {}

    const result = pipe(act({ someInput: 'hi' }), Effect.runPromise)
    expect(result).resolves.toEqual(2)
  })

  test('with dependencies', () => {
    const act = Activity.implement(sampleDef, (a) =>
      Effect.flatMap(MyDep, (dep) => Effect.succeed(a.someInput.length))
    )

    // Test: missing dep
    try {
      const result = pipe(
        act({ someInput: 'hi' }),
        Effect.catchAllDefect(() => Effect.succeed(1)),
        // @ts-expect-error missing MyDep
        Effect.runPromise
      )
    } catch (_) {}

    expect(
      pipe(
        act({ someInput: 'hi' }),
        Effect.provide(Layer.succeed(MyDep, {})),
        Effect.runPromise
      )
    ).resolves.toEqual(2)
  })
})

describe('implement a group', () => {
  test('with dependencies', () => {
    const group = Activity.implementGroup(sampleGroupDef, {
      one: (a) =>
        Effect.flatMap(MQTTClient, (client) =>
          Effect.succeed(a.someInput.length)
        ),
      two: (a) => Effect.succeed(a.someInput.length),
    })

    const promises = toMapOfPromises(
      group,
      pipe(
        Layer.succeed(MQTTClient, {} as MQTTClient),
        Layer.toRuntime,
        Effect.scoped,
        Effect.runSync
      )
    )

    const result = promises.one({ someInput: 'hi' })

    expect(result).resolves.toEqual(2)
  })

  test('with no dependencies', () => {
    const one = Activity.implement(sampleDef, (a) =>
      Effect.succeed(a.someInput.length)
    )
    const two = Activity.implement(sampleDef, (a) =>
      Effect.succeed(a.someInput.length)
    )

    const group = { one, two }
    const promises = toMapOfPromises(group, Runtime.defaultRuntime)
    const result = promises.one({ someInput: 'hi' })

    expect(result).resolves.toEqual(2)
  })

  test('constructor', () => {
    const group = asEffectGroup(sampleGroupDef, {
      one: (a) => Effect.succeed(a.someInput.length),
      two: (a) => Effect.succeed(a.someInput.length),
    })

    const promises = toMapOfPromises(group, Runtime.defaultRuntime)
    const result = promises.one({ someInput: 'hi' })

    expect(result).resolves.toEqual(2)
  })
})
