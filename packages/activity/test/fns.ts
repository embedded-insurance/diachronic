import * as S from '@effect/schema/Schema'
import { pipe } from 'effect/Function'
import { Context, Effect } from 'effect'
import { def, EffectDef, EffectImpl } from '../src/single'
import { implement } from '../src/fnobj'
import { toInvokeActivity, addActivityDef } from '../src/activity'
import { InputType } from '../src/single'

interface MyDep1 {
  prop: true
}

const MyDep1 = Context.Tag<MyDep1>('MyDep1')

interface MyDep2 {
  prop2: true
}

const MyDep2 = Context.Tag<MyDep2>('MyDep2')

const makeBuildWorkflowBundle = () => {
  const base = def({
    name: 'buildWorkflowBundle',
    input: S.struct({ workflowName: S.string }),
    output: S.struct({ workflowBundle: S.string }),
    error: S.literal('i am a type 2'),
  })
  const withAct = pipe(
    base,
    addActivityDef(({ name }) => ({ name, defaultOptions: {} }))
  )
  return pipe(
    withAct,
    Effect.succeed,
    Effect.bindTo('def'),
    Effect.let('effect', ({ def }) =>
      pipe(
        def,
        implement((input) =>
          Effect.flatMap(MyDep1, (dep) =>
            Effect.succeed({ workflowBundle: input.workflowName })
          )
        )
      )
    ),
    Effect.let(
      'activity',
      ({ def, effect }) =>
        (input: InputType<typeof def>) =>
          pipe(
            S.decode(def.input)(input),
            Effect.flatMap(effect),
            Effect.flatMap(S.decode(def.output))
            // etc
          )
    ),
    Effect.let('scheduleActivity', ({ def }) => toInvokeActivity(def)),
    Effect.runSync
  )
}

const deriveDefaults = <
  const Def extends EffectDef,
  Impl extends EffectImpl<Def, any>
>(
  defn: Def,
  impl: Impl
) => {
  return pipe(
    defn,
    addActivityDef(({ name }) => ({ name, defaultOptions: {} })),
    Effect.succeed,
    Effect.bindTo('def'),
    Effect.let('effect', () => impl),
    Effect.let(
      'activity',
      ({ def, effect }) =>
        (input: InputType<typeof def>) =>
          pipe(
            S.decode(def.input)(input),
            Effect.flatMap(effect),
            Effect.flatMap(S.decode(def.output))
            // etc
          )
    ),
    Effect.let('scheduleActivity', ({ def }) => toInvokeActivity(def)),
    Effect.runSync
  )
}

const base = def({
  name: 'buildWorkflowBundle',
  input: S.struct({ workflowName: S.string }),
  output: S.struct({ workflowBundle: S.string }),
  error: S.literal('i am a type 2'),
})
const impl = pipe(
  base,
  implement((a) => Effect.succeed({ workflowBundle: '' }))
)
const defaultsDerived = deriveDefaults(base, impl)

test('multi', () => {
  const buildWorkflowBundle = makeBuildWorkflowBundle()
  // @ts-expect-error
  buildWorkflowBundle.scheduleActivity({ workfloName: 'hi' })
  // @ts-expect-error
  buildWorkflowBundle.activity({ workfloName: 'hi' })

  // @ts-expect-error
  defaultsDerived.activity({ workfloName: 'hi' })
  // @ts-expect-error
  defaultsDerived.scheduleActivity({ workfloName: 'hi' })
})
