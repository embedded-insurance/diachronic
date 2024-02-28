import { client } from '@diachronic/http/client'
import { instruction } from './instruction/types'
import { Context, Effect, Layer } from 'effect'
import { Fetch } from '@effect-use/http-client'
import { pipe } from 'effect/Function'

export const makeWorkflowSignalerClient = (options: { baseURL?: string }) =>
  pipe(
    client({ instruction }, options),
    Effect.provide(Layer.succeed(Fetch, fetch)),
    Effect.runSync
  )

export type WorkflowSignalerClient = ReturnType<
  typeof makeWorkflowSignalerClient
>

export const WorkflowSignalerClient = Context.Tag<WorkflowSignalerClient>()

export const WorkflowSignalerClientLayer = (options: { baseURL?: string }) =>
  Layer.succeed(WorkflowSignalerClient, makeWorkflowSignalerClient(options))
