import * as S from '@effect/schema/Schema'
import { ActivityOptions, scheduleActivity } from '@temporalio/workflow'
import { pipe } from 'effect/Function'
import * as Effect from 'effect/Effect'

export const workflowFromActivity = <
  Spec extends {
    input: S.Schema<any>
    output: S.Schema<any>
    error: S.Schema<any>
    activity: { name: string; options?: ActivityOptions }
  }
>(
  spec: Spec,
  workflowName?: string
) => {
  let wf = (args: S.Schema.Type<Spec['input']>) => {
    return pipe(
      Effect.tryPromise(() =>
        scheduleActivity(
          spec.activity.name,
          [args],
          spec.activity.options || {}
        )
      ),
      Effect.runPromise
    )
  }

  Object.defineProperty(wf, 'name', {
    value: workflowName || spec.activity.name + 'Workflow',
  })

  return wf
}
