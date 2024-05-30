import * as S from '@effect/schema/Schema'
import { TemporalEnv } from '@effect-use/temporal-config'
import {
  SignalBatchInput,
  SignalWithStartBatchInput,
  SignalWithStartInput,
  SignalWorkflowInput,
  StartWorkflowInput,
} from '@effect-use/temporal-client'
import { pipe } from 'effect/Function'

export const SignalerConfig = pipe(
  TemporalEnv,
  S.extend(S.Struct({ PORT: S.NumberFromString })),
  S.extend(
    S.Struct({
      FEATURE_FLAG_SERVER_URL: S.String,
      FEATURE_FLAG_API_KEY: S.String,
      ENABLE_FEATURE_FLAGS: S.optional(S.Literal('true', 'false')),
    })
  )
)

export type SignalerConfig = S.Schema.Type<typeof SignalerConfig>

export type UpdateInstruction =
  | {
      action: 'update'
      args: SignalWorkflowInput
    }
  | {
      action: 'updateOrStart'
      args: SignalWithStartInput
    }

export type Instruction =
  | {
      action: 'signal'
      args: SignalWorkflowInput
    }
  | {
      action: 'start'
      args: StartWorkflowInput
    }
  | {
      action: 'signalBatch'
      args: SignalBatchInput
    }
  | {
      action: 'signalWithStartBatch'
      args: SignalWithStartBatchInput
    }
  | {
      action: 'signalWithStart'
      args: SignalWithStartInput
    }
  | UpdateInstruction

export const SignalWorkflowInstruction = S.Struct({
  action: S.Literal('signal'),
  args: SignalWorkflowInput,
})
export type SignalWorkflowInstruction = S.Schema.Type<
  typeof SignalWorkflowInstruction
>
export const StartWorkflowInstruction = S.Struct({
  action: S.Literal('start'),
  args: StartWorkflowInput,
})
export type StartWorkflowInstruction = S.Schema.Type<
  typeof StartWorkflowInstruction
>

export const SignalBatchInstruction = S.Struct({
  action: S.Literal('signalBatch'),
  args: SignalBatchInput,
})
export type SignalBatchInstruction = S.Schema.Type<
  typeof SignalBatchInstruction
>

export const SignalWithStartBatchInstruction = S.Struct({
  action: S.Literal('signalWithStartBatch'),
  args: SignalWithStartBatchInput,
})
export type SignalWithStartBatchInstruction = S.Schema.Type<
  typeof SignalWithStartBatchInstruction
>

export const SignalWithStartInstruction = S.Struct({
  action: S.Literal('signalWithStart'),
  args: SignalWithStartInput,
})
export type SignalWithStartInstruction = S.Schema.Type<
  typeof SignalWithStartInstruction
>

export const UpdateInstruction = S.Struct({
  action: S.Literal('update'),
  args: SignalWorkflowInput,
})
// export type UpdateInstruction = S.Schema.Type<typeof UpdateInstruction>

export const UpdateOrStartInstruction = S.Struct({
  action: S.Literal('updateOrStart'),
  args: SignalWithStartInput,
})
export type UpdateOrStartInstruction = S.Schema.Type<
  typeof UpdateOrStartInstruction
>

export const Instruction = S.Union(
  SignalWorkflowInstruction,
  StartWorkflowInstruction,
  SignalBatchInstruction,
  SignalWithStartBatchInstruction,
  SignalWithStartInstruction,
  UpdateInstruction,
  UpdateOrStartInstruction
)

export const isUpdateInstruction = (x: Instruction): x is UpdateInstruction =>
  x.action === 'update' || x.action === 'updateOrStart'

export type UnknownEvent = S.Schema.Type<typeof UnknownEvent>
export const UnknownEvent = S.Struct({
  _tag: S.Literal('UnknownWorkflowEvent'),
  error: S.String,
})
