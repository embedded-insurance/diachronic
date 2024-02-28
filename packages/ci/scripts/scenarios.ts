#!/usr/bin/env ts-node
import { Effect, pipe } from 'effect'
import {
  WorkflowSignalerClientLayer,
  WorkflowSignalerClient,
} from '@diachronic/signaler/client'

const scenarios = {
  'a workflow deploys successfully': () => {
    const workflowName = 'example'
    const versionId = 'v2'
    const environment = 'development'
    const event = {
      type: 'diachronic.ci.workflow.deploy.success',
      payload: {
        workflowName,
        versionId,
        environment,
        sha: '123',
      },
    }
    return pipe(
      Effect.flatMap(WorkflowSignalerClient, (client) =>
        client.instruction({
          body: {
            action: 'signalWithStart',
            args: {
              workflowId: 'ci.example',
              workflowType: 'workflowCI',
              taskQueue: 'development-workflowCI-workflow-ci',
              signal: event.type,
              signalArgs: [event.payload],
              workflowExecutionTimeout: '1d',
            },
          },
        })
      ),
      Effect.provide(
        WorkflowSignalerClientLayer({ baseURL: 'http://localhost:8080' })
      )
    )
  },
}

Effect.runPromise(scenarios['a workflow deploys successfully']())
