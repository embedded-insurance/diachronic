import { Effect, Layer, Runtime } from 'effect'
import * as S from '@effect/schema/Schema'
import { pipe } from 'effect/Function'
import { MQTTClient } from '@diachronic/workflow-request-response/mqtt'
import { annotateMethods, defSchemaOne, EffectDefWith } from '../src/single'
import { asEffect, asPromise } from '../src/effect'
import { defSchema } from '../src/multi'

test('annotateMethods', () => {
  type HTTPActivity = EffectDefWith<{
    'temporal.activity': { name: string; defaultOptions: any }
    http: { path: string; method: any }
  }>

  const defHTTPActivity = defSchemaOne<HTTPActivity>()
  const one = defHTTPActivity({
    name: 'hello',
    http: { method: 'GET', path: '/hello' },
    'temporal.activity': { defaultOptions: undefined, name: 'hi' },
    error: S.any,
    input: S.any,
    output: S.any,
  })

  const defMyDef = defSchema<HTTPActivity>()

  const def = defMyDef({
    hello: one,
    foo: {
      name: 'notifyDevelopers',
      input: S.struct({ message: S.string }),
      output: S.struct({
        sharedProp: S.string,
        notifyDevelopersOutputGoesHere: S.boolean,
      }),
      error: S.literal('i am a type 2'),
      http: {
        method: 'POST',
        path: '/notifyDevelopers',
      },
      ['temporal.activity']: {
        name: 'replyToSyncRequest',
        defaultOptions: {
          startToCloseTimeout: '10s',
        },
      },
    },
  })

  const annotated = annotateMethods(def, {
    foo: (a) => ({ ...a, meta: { cool: true } }),
    hello: (a) => ({ meta: { cool: true } }),
  })

  void annotated.foo.meta.cool

  // Test: was re-written to not have input
  // (fine for the moment...at least types are composing)
  //
  // @ts-expect-error
  void annotated.hello.input

  // Test: success type / general inference
  const ok = asEffect(annotated.foo, (args) =>
    Effect.succeed({
      notifyDevelopersOutputGoesHere: true,
      sharedProp: 'hi',
    })
  )
  // Test. handles R = never
  pipe(ok({ message: 'hi' }), Effect.runPromise)
  asPromise(ok, {} as Runtime.Runtime<never>)

  // Test: success type / general inference
  const ok2 = asEffect(annotated.foo, (args) =>
    Effect.flatMap(MQTTClient, (mqtt) =>
      Effect.succeed({
        notifyDevelopersOutputGoesHere: true,
        sharedProp: 'hi',
      })
    )
  )

  // Test. handles R = MQTTClient
  pipe(
    ok2({ message: 'hi' }),
    Effect.catchAllDefect(() => Effect.succeed({})),
    // @ts-expect-error MQTTClient is not assignable to Never
    Effect.runPromise
  )

  // @ts-expect-error MQTTClient is not assignable to Never
  asPromise(ok2, {} as Runtime.Runtime<never>)

  // Test. handles R = MQTTClient when R provided
  pipe(
    ok2({ message: 'hi' }),
    Effect.provide(Layer.succeed(MQTTClient, {} as MQTTClient)),
    Effect.runPromise
  )

  // Test. when runtime provides requirements
  asPromise(ok2, {} as Runtime.Runtime<MQTTClient>)

  // Test: wrong input
  asEffect(annotated.foo, (args) => {
    // @ts-expect-error
    console.log(args.mesage)
    return Effect.succeed({
      notifyDevelopersOutputGoesHere: true,
      sharedProp: 'hi',
    })
  })

  // Test: wrong output
  asEffect(annotated.foo, (args) =>
    // @ts-expect-error
    Effect.succeed({
      notifyDevelopersOutputGoesHere: true,
    })
  )
})
