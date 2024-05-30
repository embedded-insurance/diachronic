// TODO. belongs in @effect-use/git
// and re-export from a version module
import { execSync } from 'child_process'
import { pipe } from 'effect'
import * as Effect from 'effect/Effect'
import { exec, ExecError } from './util'

export const getGitBranch = () =>
  pipe(
    exec(`git branch --show-current`),
    Effect.map((x) => x.stdout.trim())
  )
export const getGitBranchSync = () =>
  execSync(`git branch --show-current`).toString().trim()

export const getGitShaShort = () =>
  pipe(
    exec(`git rev-parse --short HEAD`),
    Effect.map((x) => x.stdout.trim())
  )
export const getGitShaShortSync = () =>
  execSync(`git rev-parse --short HEAD`).toString().trim()

export const getGitRepoRoot = (): Effect.Effect<string, ExecError> =>
  pipe(
    exec(`git rev-parse --show-toplevel`),
    Effect.map((x) => x.stdout.trim())
  )

export const getGitRepoRootSync = () =>
  execSync(`git rev-parse --show-toplevel`).toString().trim()
