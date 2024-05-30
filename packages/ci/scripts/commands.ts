import { Console, Effect, pipe } from 'effect'
import { defGroup, implement, implementGroup } from '@diachronic/activity/cli'
import * as S from '@effect/schema/Schema'
import {
  googleCloudLoggingLink,
  temporalUILink,
} from '@diachronic/toolbox/infra/links'
import { CallableGroup } from '@diachronic/activity/effect'
import {
  WorkflowSignalerClientLayer,
  WorkflowSignalerClient,
} from '@diachronic/signaler/client'

const commands = defGroup({
  signalExampleWorkflowSuccess: {
    name: 'signalLeadWorkflowSuccess',
    'diachronic.cli': {
      description: `Simulates a successful example workflow deployment event.`,
    },
    input: S.Undefined,
    output: S.Any,
    error: S.Any,
  },
})
const signalExampleWorkflowSuccess = implement(
  commands.signalExampleWorkflowSuccess,
  () =>
    pipe(
      Effect.Do,
      Effect.let('event', () => ({
        type: 'diachronic.ci.workflow.deploy.success',
        payload: {
          workflowName: 'example',
          versionId: 'v12',
          environment: 'development',
          sha: '123',
        },
      })),
      Effect.let(
        'instruction',
        ({ event }) =>
          ({
            action: 'signalWithStart',
            args: {
              workflowId: 'ci.example',
              workflowType: 'workflowCI',
              // todo. get task queue from the manifests that are returned
              // to the loop function and provide here
              taskQueue: 'workflowCI-drain-signals-before-migrate',
              signal: event.type,
              signalArgs: [event.payload],
              workflowExecutionTimeout: '1d',
              searchAttributes: {},
            },
          } as const)
      ),
      Effect.flatMap(({ instruction }) =>
        pipe(
          Effect.flatMap(WorkflowSignalerClient, (client) =>
            client.instruction({ body: instruction })
          ),
          Effect.tap((a) => {
            let x = a as { workflowId: string; runId: string }
            return pipe(
              Console.info(`Workflow execution started`, x),
              Effect.tap(() =>
                Console.info({
                  ui: temporalUILink(
                    'development',
                    'example',
                    x.workflowId,
                    x.runId
                  ),
                  logs: googleCloudLoggingLink({
                    environment: 'development',
                    workflowName: 'example',
                    versionId: 'v2',
                  }),
                })
              )
            )
          })
        )
      ),
      Effect.provide(
        WorkflowSignalerClientLayer({ baseURL: 'http://localhost:8080' })
      )
    )
)

export const makeCommands = (): CallableGroup<typeof commands> =>
  implementGroup(commands, {
    signalExampleWorkflowSuccess,
  })
