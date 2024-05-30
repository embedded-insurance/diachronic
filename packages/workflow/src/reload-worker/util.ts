import { ExecException } from 'child_process'
import * as ChildProcess from 'node:child_process'
import { Effect } from 'effect'
import { pipe } from 'effect/Function'
import fs from 'fs'
import path from 'path'
import { Fetch } from '@effect-use/http-client'
import { finished } from 'stream/promises'
import { Readable } from 'stream'

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
 * Effect version of Node.js `exec`
 * @param cmd
 * @param options
 * @param stdio
 */
export const exec = (
  cmd: string,
  options?: ChildProcess.ExecOptions,
  stdio?: { stdout?: boolean; stderr?: boolean }
): Effect.Effect<ExecSuccess, ExecError> =>
  pipe(
    Effect.logDebug(`Executing shell command`),
    Effect.annotateLogs({ $: cmd }),
    Effect.flatMap(() =>
      Effect.async<ExecSuccess, ExecError>((resume) => {
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

export const untar = (from: string, to: string) =>
  exec(`tar -xzf ${from} -C ${to}`)

export const ensureDir = (dir: string) =>
  Effect.async<void, NodeJS.ErrnoException>((resume) =>
    fs.mkdir(dir, { recursive: true }, (e) =>
      resume(e ? Effect.fail(e) : Effect.succeed(Effect.void))
    )
  )

export const removeDirectory = (dir: string) =>
  Effect.tryPromise(() => fs.promises.rm(dir, { recursive: true }))

export const downloadFileHTTP = (url: string, to: string) =>
  pipe(
    ensureDir(path.dirname(to)),
    Effect.tap(() =>
      pipe(
        Effect.logDebug('Downloading file from url'),
        Effect.annotateLogs({ url, to })
      )
    ),
    Effect.flatMap(() =>
      Effect.flatMap(Fetch, (fetch) =>
        Effect.tryPromise(async () => {
          const res = await fetch(url, { method: 'GET' })
          if (!res.body) {
            throw new Error('No body')
          }
          const writeStream = fs.createWriteStream(to)
          return await finished(Readable.fromWeb(res.body).pipe(writeStream))
        })
      )
    )
  )
