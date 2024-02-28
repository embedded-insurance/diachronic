import { exec, ExecError } from '@diachronic/toolbox/infra/util'
import { Context, Effect, pipe } from 'effect'
import { NonEmptyArray } from 'effect/ReadonlyArray'
import { UnknownException } from 'effect/Cause'
import { KubectlOpts, NoDeploymentsFound } from './types'
// import type { Deployment } from '@ei-tech/k8s-api/v1/Deployment'
type Deployment = any

export const parseOpts = (opts: KubectlOpts) => {
  const namespaceFilter = opts?.namespace ? `-n ${opts.namespace}` : ''
  const labelsFilter = opts?.labels
    ? // Defaults to "and" semantics
      '-l ' +
      Object.entries(opts.labels)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')
    : ''
  const extraFlags = opts?.extraFlags || ''
  const outputFormat = `-o json`
  const allNamespaces = opts?.allNamespaces ? '-A' : ''
  const name = opts?.name || ''

  return {
    namespaceFilter,
    labelsFilter,
    extraFlags,
    outputFormat,
    allNamespaces,
    name,
  }
}
export const makeKubectl = () => ({
  cmd: (s: string) => exec(`kubectl ${s}`),
  delete: {
    deployment: (
      opts?: KubectlOpts
    ): Effect.Effect<never, string | ExecError, string> => {
      const {
        namespaceFilter,
        labelsFilter,
        extraFlags,
        // outputFormat,
        allNamespaces,
        name,
      } = parseOpts(opts || {})
      const args = [
        name,
        namespaceFilter,
        labelsFilter,
        allNamespaces,
        extraFlags,
      ]
        .filter(Boolean)
        .join(' ')

      const cmd = `kubectl delete deployment ${args}`

      return pipe(
        Effect.logDebug(cmd),
        Effect.flatMap(() => exec(cmd)),
        Effect.flatMap(({ stdout, stderr }) => {
          if (stderr) {
            return Effect.fail(stderr)
          }
          return Effect.succeed(stdout)
        }),
        Effect.withLogSpan('@diachronic.kubectl')
      )
    },
  },
  get: {
    deployment: (
      opts?: KubectlOpts
    ): Effect.Effect<
      never,
      NoDeploymentsFound | ExecError | UnknownException,
      NonEmptyArray<Deployment>
    > => {
      const {
        namespaceFilter,
        labelsFilter,
        extraFlags,
        outputFormat,
        allNamespaces,
        name,
      } = parseOpts(opts || {})
      const args = [
        name,
        namespaceFilter,
        labelsFilter,
        outputFormat,
        allNamespaces,
        extraFlags,
      ]
        .filter(Boolean)
        .join(' ')

      const cmd = `kubectl get deployment ${args}`

      return pipe(
        Effect.logDebug(cmd),
        Effect.flatMap(() => exec(cmd)),
        Effect.flatMap(({ stdout }) => Effect.try(() => JSON.parse(stdout))),
        Effect.flatMap((data) => {
          if (data.apiVersion === 'apps/v1' && data.kind === 'Deployment') {
            return Effect.succeed([data] as NonEmptyArray<Deployment>)
          }
          if (data.apiVersion === 'v1' && data.kind === 'List') {
            // for -o json kubectl returns an empty list if no results are found
            // it's questionable whether we map this to the error channel
            if (!data.items.length) {
              return Effect.fail(
                new NoDeploymentsFound({
                  message:
                    'No deployments found for query: ' + JSON.stringify(opts),
                  data: { cmd },
                })
              )
            }
            return Effect.succeed(data.items as NonEmptyArray<Deployment>)
          }
          throw new Error(
            "Unexpected response from kubectl: '" + JSON.stringify(data) + "'"
          )
        }),
        Effect.withLogSpan('@diachronic.kubectl')
      )
    },
  },
})

export type Kubectl = ReturnType<typeof makeKubectl>

export const Kubectl = Context.Tag<Kubectl>()
