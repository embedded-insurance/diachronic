#!/usr/bin/env ts-node
import yargs from 'yargs'
import * as S from '@effect/schema/Schema'
import {
  TemporalClient,
  createTemporalClientLayer,
  signal,
} from '@effect-use/temporal-client'
import { configFromEnv } from '@effect-use/temporal-config'
import { pipe } from 'effect/Function'
import * as Effect from 'effect/Effect'
import {
  AsyncWorkflowListIterable,
  WorkflowExecutionInfo,
} from '@temporalio/client'

const EnvSchema = S.struct({
  TEMPORAL_ADDRESS: S.string,
  TEMPORAL_NAMESPACE: S.string,
})

type EnvSchema = S.Schema.To<typeof EnvSchema>

const signalMigrate = (workflowId: string, newQueue: string) => {
  const signalArgs = {
    workflowId,
    signal: 'diachronic.v1.migrate',
    signalArgs: [{ taskQueue: newQueue }],
  }

  return pipe(
    TemporalClient,
    Effect.flatMap((client) => {
      console.log(`signaling ${workflowId} with ${JSON.stringify(signalArgs)}`)
      return signal(signalArgs)
    })
  )
}

const getWorkflowHandles = (workflowType: string, taskQueue: string) => {
  return pipe(
    TemporalClient,
    Effect.map((client) => {
      const result: AsyncWorkflowListIterable = client.workflow.list({
        query: `WorkflowType = '${workflowType}' and TaskQueue='${taskQueue}' and ExecutionStatus = 'Running'`,
      })
      return result
    })
  )
}

const getIds = async (l: AsyncWorkflowListIterable): Promise<string[]> => {
  const result = []
  for await (const handle of l) {
    result.push(handle.workflowId)
  }
  return result
}

const migrate = async (
  workflowType: string,
  oldQueue: string,
  newQueue: string,
  env: EnvSchema
) => {
  pipe(
    getWorkflowHandles(workflowType, oldQueue),
    Effect.flatMap((l) => Effect.tryPromise(() => getIds(l))),
    Effect.map((ids) => ids.map((id) => signalMigrate(id, newQueue))),
    Effect.flatMap((x) => Effect.all(x)),
    Effect.provide(createTemporalClientLayer(configFromEnv(env))),
    Effect.scoped,
    Effect.runPromise
  )
}

const options = yargs(process.argv.slice(2))
  .usage(
    'Usage: $0 --workflowType <workflowType> --oldTaskQueue <oldTaskQueue> --newTaskQueue <newTaskQueue>'
  )
  .option('workflowType', {
    describe: 'The type of workflow to migrate',
    type: 'string',
    demandOption: true,
  })
  .option('oldTaskQueue', {
    describe: 'The name of the old task queue',
    type: 'string',
    demandOption: true,
  })
  .option('newTaskQueue', {
    describe: 'The name of the new task queue',
    type: 'string',
    demandOption: true,
  })
  .option('env', {
    describe: 'Temporal env / .env.dev / .env.local',
    type: 'string',
    choices: ['.env.dev', '.env.local'],
    demandOption: true,
  })
  .help()
  .alias('help', 'h')
  .parseSync()

require('dotenv').config({
  path: require('path').resolve(__dirname, options.env),
})

const env = S.decodeUnknownSync(EnvSchema)(process.env, { errors: 'all' })

migrate(options.workflowType, options.oldTaskQueue, options.newTaskQueue, env)
