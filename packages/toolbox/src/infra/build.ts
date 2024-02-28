import { compileWorkflow } from '@diachronic/workflow/build-workflow'
import { compileActivities } from '@diachronic/workflow/build-activities'
import * as path from 'path'
import { Effect, Either, pipe } from 'effect'
import { AnyStateMachine } from 'xstate'
import { genMigrationStatesType } from '@diachronic/migrate/visit'
import { Environment } from './environment'
import { writeFile } from './file'

export type CompileConfig =
  | {
      type: 'workflow'
      name: string
      entrypoint: string
      ignoreModules?: string[]
    }
  | {
      type: 'activities'
      name: string
      entrypoint: string
    }
  | {
      type: 'statechart'
      name: string
      ref: AnyStateMachine
    }

export type BuildSpec =
  | {
      type: 'workflow'
      name: string
      entrypoint?: string
      ignoreModules?: string[]
    }
  | {
      type: 'activities'
      name: string
      entrypoint?: string
    }
  | {
      type: 'statechart'
      name: string
      ref?: AnyStateMachine
    }

type BuildStepFailure = any
type BuildStepSuccess = any
type BuildFn = (args: {
  versionId: string
}) => Effect.Effect<
  Environment,
  unknown,
  Either.Either<BuildStepFailure[], BuildStepSuccess[]>
>

export const compile = (args: {
  config: Array<CompileConfig>
  versionId: string
  outputDir: string
}) =>
  Effect.all(
    args.config.map((x) => {
      switch (x.type) {
        case 'workflow':
          return pipe(
            compileWorkflow({
              ...x,
              outputFilePath: path.join(args.outputDir, `workflow.js`),
              workflowsPath: x.entrypoint,
            }),
            Effect.tap(() => Effect.logDebug('Workflow compiled ok')),
            Effect.tapErrorCause((e) =>
              Effect.logError('Workflow compilation error', e)
            )
          )
        case 'activities':
          return pipe(
            compileActivities({
              inputFilePath: x.entrypoint,
              outputFilePath: path.join(args.outputDir, `activities.js`),
            }),
            Effect.tap(() => Effect.logDebug('Activities compiled ok')),
            Effect.tapErrorCause((e) => Effect.logError(e)),
            Effect.withLogSpan('compile-activities')
          )
        case 'statechart':
          return pipe(
            Effect.try(() => genMigrationStatesType(x.ref)),
            Effect.flatMap((s: string) =>
              writeFile(
                path.join(
                  args.outputDir,
                  `statechart_${x.name}_${args.versionId}.d.ts`
                ),
                s
              )
            ),
            Effect.tap(() => Effect.logDebug('Statechart compiled ok')),
            Effect.tapErrorCause((e) =>
              Effect.logError('Statechart compile error', e)
            )
          )
      }
    }),
    {
      concurrency: 'unbounded',
      mode: 'either',
    }
  )
