import { pipe } from 'effect/Function'
import * as Effect from 'effect/Effect'
import { getTaskQueueOrFail } from './task-queue'
import {
  signal,
  signalBatch,
  signalWithStart,
  signalWithStartBatch,
  startWorkflow,
  TemporalClient,
} from '@effect-use/temporal-client'
import { Instruction, isUpdateInstruction } from './types'
import * as Duration from 'effect/Duration'
import { workflowUpdate } from '@diachronic/workflow-request-response'
import { implement } from '@diachronic/http'
import { instruction } from './instruction/types'

const defaultWorkflowUpdateRequestTimeout = Duration.millis(4000)

const fns = {
  signal,
  start: startWorkflow,
  signalBatch,
  signalWithStartBatch,
  signalWithStart,
} as const

export const sendInstruction = ({
  instruction,
}: {
  instruction: Instruction
}) =>
  isUpdateInstruction(instruction)
    ? workflowUpdate(instruction, defaultWorkflowUpdateRequestTimeout)
    : (fns[instruction.action](instruction.args as any) as Effect.Effect<
        TemporalClient,
        any,
        any
      >)

export const handler = implement(instruction, ({ body }) =>
  pipe(
    Effect.succeed(body),
    Effect.annotateLogs({ body }),
    Effect.flatMap(() => {
      switch (body.action) {
        case 'start':
        case 'signalWithStart':
        case 'updateOrStart': {
          if (body.args.taskQueue) {
            return pipe(
              Effect.logDebug('Using provided taskQueue'),
              Effect.annotateLogs({ taskQueue: body.args.taskQueue }),
              Effect.flatMap(() => Effect.succeed(body))
            )
          }
          return pipe(
            Effect.logDebug('Getting taskQueue from feature flag'),
            Effect.flatMap(() =>
              getTaskQueueOrFail(body.args.workflowType, {
                userId: body.args.workflowId,
                // @ts-expect-error
                isTest: body.searchAttributes?.isTest,
              })
            ),
            Effect.map(
              (x) =>
                ({
                  ...body,
                  args: { ...body.args, taskQueue: x },
                } as Instruction)
            ),
            Effect.tapError(Effect.logError)
          )
        }

        // TODO. this has an array of instructions w task queue for each
        // case 'signalWithStartBatch':

        // Whatever this is doesn't take a task queue as an argument
        default:
          return Effect.succeed(body)
      }
    }),
    Effect.flatMap((instruction) => sendInstruction({ instruction }))
  )
)
