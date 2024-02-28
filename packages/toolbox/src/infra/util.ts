import { ExecException } from 'child_process'
import ChildProcess from 'child_process'
import * as Effect from 'effect/Effect'
import { Context, Layer, pipe } from 'effect'
import * as fs from 'fs'
import * as S from '@effect/schema/Schema'
import * as AST from '@effect/schema/AST'

export const camelToKebabCase = <const S extends string>(str: S) =>
  str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

// For now this is essentially a marker type that we may elect to exchange
// with effect/platform
// It signifies the runtime conext has a way to run commands
// and provides a way to run commands
export type Shell = {
  exec: (cmd: string) => Effect.Effect<never, ExecError, ExecSuccess>
}
const Shell = Context.Tag<Shell>('diachronic.Shell')

export type ExecError = {
  error: ExecException
  stdout: string
  stderr: string
}
export type ExecSuccess = {
  error: null
  stdout: string
  stderr: string
}

/**
 * Effect version of Node.js `spawn`
 * @param cmd
 * @param options
 * @param stdio
 */
export const spawn = (
  cmd: string,
  options?: ChildProcess.ExecOptions,
  stdio?: { stdout?: boolean; stderr?: boolean }
): Effect.Effect<never, ExecError, ChildProcess.ChildProcess> =>
  pipe(
    Effect.logDebug(`Streaming shell command:${cmd}`),
    Effect.map(() =>
      ChildProcess.spawn(
        cmd.split(' ')[0],
        cmd
          .split(' ')
          .map((x) => x.trim())
          .filter((x) => x !== '')
          .slice(1)
      )
    )
  )

/**
 * Effect version of Node.js `exec`
 * @param cmd
 * @param options
 * @param stdio
 */
export const exec = (
  cmd: string,
  options?: ChildProcess.ExecOptions,
  stdio?: { stdout?: boolean; stderr?: boolean }
): Effect.Effect<never, ExecError, ExecSuccess> =>
  pipe(
    Effect.logDebug(`Executing shell command`),
    Effect.annotateLogs({ $: cmd }),
    Effect.flatMap(() =>
      Effect.async<never, ExecError, ExecSuccess>((resume) => {
        const cp = ChildProcess.exec(
          cmd,
          options || {},
          (error, stdout, stderr) => {
            if (error) {
              resume(Effect.fail({ error, stdout, stderr }))
            } else {
              resume(Effect.succeed({ error, stdout, stderr }))
            }
          }
        )
        // todo. rewrite this whole thing using nodejs spawn instead of exec
        // keep the same general interface
        if (stdio) {
          cp.stdout?.on('data', (d) => process.stdout.write(d))
          cp.stderr?.on('data', (d) => process.stderr.write(d))
        }
      })
    )
  )

/**
 * Effect version of NodeJS readFile
 * @param path
 */
export const readFile = (path: string) =>
  Effect.async<never, NodeJS.ErrnoException, Buffer>((resume) => {
    void fs.readFile(path, (err, data) => {
      if (err) {
        resume(Effect.fail(err))
      } else {
        resume(Effect.succeed(data))
      }
    })
  })

export const ShellLayer = {
  of: (shell: Shell) => Layer.succeed(Shell, shell),
  default: () =>
    Layer.succeed(Shell, {
      exec,
    }),
}

export const getRepoRoot = (): Effect.Effect<never, ExecError, string> =>
  pipe(
    exec(`git rev-parse --show-toplevel`),
    Effect.map((x) => x.stdout.trim())
  )

/**
 * Get the description of a schema
 * @param x
 */
export const getDescription = (x: S.Schema<never, any, any>): string | null =>
  pipe(AST.getAnnotation(AST.DescriptionAnnotationId)(x.ast), (a) =>
    a._tag === 'None' ? null : (a.value as string)
  )

// todo. belongs in a versoning module
export const makeTimestampVersionId = () =>
  new Date().toISOString().toLowerCase().replace(/:/g, '-').replace(/\./g, '-')
