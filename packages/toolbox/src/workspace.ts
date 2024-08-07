import * as Effect from 'effect/Effect'
import * as S from '@effect/schema/Schema'
import { def } from '@diachronic/activity/cli'
import { pipe } from 'effect'
import { asAnnotatedEffect } from '@diachronic/activity/fnobj'
import * as path from 'path'
import * as R from 'ramda'
import { exec, getRepoRoot, readFile } from './infra/util'
import { decode } from '@diachronic/util/decode'

/**
 * Represents a (yarn) workspace / monorepo package
 */
export const Workspace = S.Struct({ location: S.String, name: S.String })
export type Workspace = S.Schema.Type<typeof Workspace>

export const Workspaces = S.Array(Workspace)
export type Workspaces = S.Schema.Type<typeof Workspaces>

export const listAllWorkspaces = asAnnotatedEffect(
  def({
    name: 'listAllWorkspaces',
    input: S.Undefined,
    output: Workspaces,
    error: S.Unknown,
    'diachronic.cli': {
      name: 'listAllWorkspaces',
    },
  }),
  (args) =>
    pipe(
      // todo. this should use some dep that requires
      // a command executor. this is in latest version of effect platform maybe
      exec('yarn workspaces list --json'),
      Effect.flatMap((result) =>
        Effect.try(() =>
          result.stdout
            .trim()
            .split('\n')
            .map((x) => JSON.parse(x))
        )
      ),
      Effect.flatMap(decode(Workspaces)),
      Effect.withLogSpan('listAllWorkspaces')
    )
)

export const listWorkspaceDependents = asAnnotatedEffect(
  def({
    name: 'listWorkspaceDependents',
    input: pipe(
      S.Union(S.Struct({ workspaces: S.Array(S.String) }), S.Undefined),
      S.description('The workspaces to list dependents for')
    ),
    output: S.Array(
      S.Struct({
        type: S.Literal('dependency', 'devDependency'),
        source: Workspace,
        target: Workspace,
      })
    ),
    error: S.Unknown,
    'diachronic.cli': {
      path: ['workspace', 'deps'],
    },
  }),
  (args) =>
    pipe(
      Effect.Do,
      Effect.bind('allWorkspaces', () => listAllWorkspaces(void 0)),
      Effect.let('sourceWorkspaces', ({ allWorkspaces }) =>
        !args || args.workspaces.length === 0
          ? allWorkspaces
          : allWorkspaces.filter((x) => args?.workspaces.includes(x.name))
      ),
      Effect.bind('repoRoot', getRepoRoot),
      Effect.flatMap(({ repoRoot, sourceWorkspaces, allWorkspaces }) =>
        Effect.all(
          sourceWorkspaces.map((source) =>
            pipe(
              readFile(path.join(repoRoot, source.location, 'package.json')),
              Effect.flatMap((x) =>
                Effect.try(() => {
                  const pkg = JSON.parse(x.toString())
                  return [
                    ...Object.entries(pkg.dependencies || {})
                      .filter(([_, v]) => (v as string).startsWith('workspace'))
                      .map((a) => a[0] as string)
                      .map((name) => ({
                        type: 'dependency' as const,
                        source,
                        target: allWorkspaces.find((x) => x.name === name)!,
                      })),
                    ...Object.entries(pkg.devDependencies || {})
                      .filter(([_, v]) => (v as string).startsWith('workspace'))
                      .map((a) => a[0] as string)
                      .map((name) => ({
                        type: 'devDependency' as const,
                        source,
                        target: allWorkspaces.find((x) => x.name === name)!,
                      })),
                  ]
                })
              )
            )
          )
        )
      ),
      Effect.map(R.flatten)
    )
)
