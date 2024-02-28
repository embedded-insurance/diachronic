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
  S.extend(S.struct({ PORT: S.NumberFromString })),
  S.extend(
    S.struct({
      FEATURE_FLAG_SERVER_URL: S.string,
      FEATURE_FLAG_API_KEY: S.string,
      ENABLE_FEATURE_FLAGS: S.optional(S.literal('true', 'false')),
    })
  )
)

export type SignalerConfig = S.Schema.To<typeof SignalerConfig>

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

export const SignalWorkflowInstruction = S.struct({
  action: S.literal('signal'),
  args: SignalWorkflowInput,
})
export type SignalWorkflowInstruction = S.Schema.To<
  typeof SignalWorkflowInstruction
>
export const StartWorkflowInstruction = S.struct({
  action: S.literal('start'),
  args: StartWorkflowInput,
})
export type StartWorkflowInstruction = S.Schema.To<
  typeof StartWorkflowInstruction
>

export const SignalBatchInstruction = S.struct({
  action: S.literal('signalBatch'),
  args: SignalBatchInput,
})
export type SignalBatchInstruction = S.Schema.To<typeof SignalBatchInstruction>

export const SignalWithStartBatchInstruction = S.struct({
  action: S.literal('signalWithStartBatch'),
  args: SignalWithStartBatchInput,
})
export type SignalWithStartBatchInstruction = S.Schema.To<
  typeof SignalWithStartBatchInstruction
>

export const SignalWithStartInstruction = S.struct({
  action: S.literal('signalWithStart'),
  args: SignalWithStartInput,
})
export type SignalWithStartInstruction = S.Schema.To<
  typeof SignalWithStartInstruction
>

export const UpdateInstruction = S.struct({
  action: S.literal('update'),
  args: SignalWorkflowInput,
})
// export type UpdateInstruction = S.Schema.To<typeof UpdateInstruction>

export const UpdateOrStartInstruction = S.struct({
  action: S.literal('updateOrStart'),
  args: SignalWithStartInput,
})
export type UpdateOrStartInstruction = S.Schema.To<
  typeof UpdateOrStartInstruction
>

export const Instruction = S.union(
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

export type UnknownEvent = S.Schema.To<typeof UnknownEvent>
export const UnknownEvent = S.struct({
  _tag: S.literal('UnknownWorkflowEvent'),
  error: S.string,
})
