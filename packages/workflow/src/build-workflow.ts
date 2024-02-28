import { bundleWorkflowCode } from '@temporalio/worker'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import { writeFile } from 'fs/promises'

export const createWorkflowBundle = (args: {
  workflowsPath: string
  workflowInterceptorModules?: string[] | undefined
  metadata?: Record<string, any>
  ignoreModules?: string[]
}) =>
  Effect.tryPromise(() =>
    // @ts-ignore exact optional property types were a mistake
    bundleWorkflowCode({
      ignoreModules: args.ignoreModules,
      workflowsPath: args.workflowsPath,
      workflowInterceptorModules: args.workflowInterceptorModules as any,
    })
  )

export const compileWorkflow = (args: {
  outputFilePath: string
  workflowsPath: string
  workflowInterceptorModules?: string[]
  ignoreModules?: string[]
  metadata?: Record<string, any>
}) =>
  pipe(
    createWorkflowBundle(args),
    Effect.flatMap(({ code }) =>
      Effect.tryPromise(() => writeFile(args.outputFilePath, code))
    )
  )
