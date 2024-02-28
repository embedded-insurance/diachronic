import { Effect, pipe } from 'effect'
import { getGitRepoRoot } from './git'
import path from 'path'
import { listWorkspaceDependents } from '@diachronic/toolbox/workspace'

/**
 * Returns absolute filepaths to the local monorepo modules that
 * `packageName` depends on
 * @param packageName
 */
export const filepathsOfDependentModules = (packageName: string) =>
  pipe(
    Effect.Do,
    Effect.bind('deps', () =>
      listWorkspaceDependents({
        workspaces: [packageName],
      })
    ),
    Effect.bind('pathToMonorepoRoot', () => getGitRepoRoot()),
    Effect.map(({ deps, pathToMonorepoRoot }) =>
      deps.map((x) => path.join(pathToMonorepoRoot, x.target.location))
    )
  )
