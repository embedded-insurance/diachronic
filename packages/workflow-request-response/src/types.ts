import * as S from '@effect/schema/Schema'
import { Simplify } from 'effect/Types'

export type RequestResponseSchema<
  Id extends string,
  Input extends S.Schema<any>,
  Output extends S.Schema<any>,
  Error extends S.Schema<any>
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
  Input extends S.Schema<any>,
  Output extends S.Schema<any>,
  Error extends S.Schema<any>
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
  input: S.Struct({
    type: S.Literal(type),
    payload: input,
  }),
  workflowInput: S.Struct({
    type: S.Literal(type),
    meta: S.Struct({ topic: S.String }),
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
  output: S.Struct({
    type: S.Literal(`${type}/success`),
    payload: output,
  }),
  error: S.Struct({
    type: S.Literal(`${type}/failure`),
    payload: error,
  }),
})

export const WorkflowOutput = <
  const A extends string,
  B extends S.Schema<any>,
  C extends S.Schema<any>,
  D extends S.Schema<any>
>(
  a: RequestResponseSchema<A, B, C, D>
):
  | S.Schema<
      never,
      Simplify<
        S.Schema.Type<typeof a.output> & {
          readonly meta: { readonly topic: string }
        }
      >
    >
  | S.Schema<
      never,
      Simplify<
        S.Schema.Type<typeof a.error> & {
          readonly meta: { readonly topic: string }
        }
      >
    > =>
  S.Union(
    S.extend(a.output, S.Struct({ meta: S.Struct({ topic: S.String }) })),
    S.extend(a.error, S.Struct({ meta: S.Struct({ topic: S.String }) }))
  ) as any
