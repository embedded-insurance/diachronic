import * as S from '@effect/schema/Schema'
import { Simplify } from 'effect/Types'

export type RequestResponseSchema<
  Id extends string,
  Input extends S.Schema<never, any>,
  Output extends S.Schema<never, any>,
  Error extends S.Schema<never, any>
> = {
  type: Id
  input: Input
  output: Output
  error: Error
}
export const WorkflowRequestMetaKey =
  'diachronic.workflow.request.meta' as const
export type WorkflowRequestMetaKey = typeof WorkflowRequestMetaKey

export const RequestResponseSchema = <
  const Id extends string,
  Input extends S.Schema<never, any>,
  Output extends S.Schema<never, any>,
  Error extends S.Schema<never, any>
>({
  type,
  input,
  output,
  error,
}: {
  type: Id
  input: Input
  output: Output
  error: Error
}) => ({
  type,
  input: S.struct({
    type: S.literal(type),
    payload: input,
  }),
  workflowInput: S.struct({
    type: S.literal(type),
    meta: S.struct({ topic: S.string }),
    payload: input,
  }),
  // maybe just define this since TS is having a hard time with inference
  // workflowOutput: S.union(
  //   S.struct({
  //     type: S.literal(`${type}/success`),
  //     meta: S.struct({ topic: S.string }),
  //     payload: output,
  //   }),
  //   S.struct({
  //     type: S.literal(`${type}/failure`),
  //     meta: S.struct({ topic: S.string }),
  //     payload: error,
  //   })
  // ),
  output: S.struct({
    type: S.literal(`${type}/success`),
    payload: output,
  }),
  error: S.struct({
    type: S.literal(`${type}/failure`),
    payload: error,
  }),
})

export const WorkflowOutput = <
  const A extends string,
  B extends S.Schema<never, any>,
  C extends S.Schema<never, any>,
  D extends S.Schema<never, any>
>(
  a: RequestResponseSchema<A, B, C, D>
):
  | S.Schema<
      never,
      Simplify<
        S.Schema.To<typeof a.output> & {
          readonly meta: { readonly topic: string }
        }
      >
    >
  | S.Schema<
      never,
      Simplify<
        S.Schema.To<typeof a.error> & {
          readonly meta: { readonly topic: string }
        }
      >
    > =>
  S.union(
    S.extend(a.output, S.struct({ meta: S.struct({ topic: S.string }) })),
    S.extend(a.error, S.struct({ meta: S.struct({ topic: S.string }) }))
  ) as any
