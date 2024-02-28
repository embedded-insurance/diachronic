import { Console, Duration, Effect, Schedule } from 'effect'
import { yamlCat } from '@diachronic/util/yaml'
import { pipe } from 'effect/Function'
import { Environment } from './environment'
import path from 'path'
import { ensureDir, writeFile } from './file'
import { isVersioned, KubernetesManifest } from './manifests'
import { exec, spawn } from './util'
// import { Event } from '@ei-tech/k8s-api/v1/Event'
type Event = any

export const apply = (path: string) =>
  exec(`kubectl apply -f ${path}`, {}, { stderr: true, stdout: true })

/**
 * Converts k8s manifests to yaml and writes to the specified filepath
 * @param args
 */
export const writeManifests = (args: { filepath: string; manifests: any[] }) =>
  pipe(
    yamlCat(args.manifests),
    Effect.flatMap((yaml) => writeFile(args.filepath, yaml))
  )

export const k8sManifestsFilepath = (
  cwd: string,
  environmentName: Environment
) => path.join(cwd, 'k8s', 'out', environmentName)

/**
 * Pipeline step helper, saves manifests the way we want to normally
 * Handles partitioning of versioned manifests from non-versioned manifests
 * into separate files so we can more easily unapply what we need to when
 * spinning down Temporal workers.
 * A versioned manifests is any for which `isVersioned` returns truthy for.
 * Whether versioned or not, manifests are currently concatenated into a single file
 * and partitioned on the filesystem by environment name.
 *
 * Returns an array of filepaths that were written to
 * @param args
 */
export const saveManifests = (args: {
  manifests: any[] // KubernetesManifest[] todo. types are wack
  cwd: string
  environmentName: Environment
  versionId: string
}) => {
  const { manifests, cwd, environmentName, versionId } = args
  const envDirPath = k8sManifestsFilepath(cwd, environmentName)
  const versioned = manifests.filter(isVersioned)
  const notVersioned = manifests.filter(
    (x: KubernetesManifest) => !isVersioned(x)
  )
  const commonFilepath = notVersioned.length
    ? path.join(envDirPath, 'common.yaml')
    : null

  const versionedFilepath = versioned.length
    ? path.join(envDirPath, `${versionId}.yaml`)
    : null

  return pipe(
    ensureDir(envDirPath),
    Effect.flatMap(() =>
      commonFilepath
        ? writeManifests({
            filepath: commonFilepath,
            manifests: notVersioned,
          })
        : Effect.unit
    ),
    Effect.flatMap(() =>
      versionedFilepath
        ? writeManifests({
            filepath: versionedFilepath,
            manifests: versioned,
          })
        : Effect.unit
    ),
    Effect.map(() => ({
      filepaths: [
        commonFilepath ? { label: 'common', path: commonFilepath } : null,
        versionedFilepath
          ? { label: 'versioned', path: versionedFilepath }
          : null,
      ].filter(Boolean) as Array<{ label: string; path: string }>,
    }))
  )
}

/**
 * Waits for a deployment to complete
 * This will wait forever when err image pull. We can specify a timeout that defaults to the readiness probe timeout,
 * In certain cases, stderr will return "deployment x exceeded its progress deadline"
 * Really we should provide better feedback about what's going wrong. Ie, after x seconds, run get status and print the result
 * Uses the native `kubectl rollout` command, which can also accept a file containing resources to watch
 * Resources other than deployments may have status watchers implemented!
 * @param name
 * @param namespace
 */
export const waitForDeploymentRolloutComplete = ({
  name,
  namespace,
}: {
  name: string
  namespace: string
}) =>
  exec(`kubectl rollout status deployment/${name} -n ${namespace}`, undefined, {
    stderr: true,
    stdout: true,
  })

// todo. assumes a deployment
export const getLogs = ({
  name,
  namespace,
}: {
  name: string
  namespace: string
}) => exec(`kubectl logs deployment/${name} -n ${namespace}`, undefined)

// todo. assumes a deployment
export const streamLogs = ({
  name,
  namespace,
}: {
  name: string
  namespace: string
}) => spawn(`kubectl logs -f deployment/${name} -n ${namespace}`)

// Notes. We can get relevant events for a deployment from the following queries:
// 1.  kubectl get event --namespace my-cool-namespace --field-selector involvedObject
// .name=policy-activity-scraper-workflow-artifacts-deployment -o json

// 2. same but kind pod policy-activity-scraper-workflow-artifacts-deployment-6865wlm27.
// this will include any default-scheduler, cluster-autoscaler events

export const getEvents = (kobj: any) =>
  pipe(
    exec(
      [
        `kubectl get event`,
        `--namespace ${kobj.metadata.namespace}`,
        `--field-selector involvedObject.name=${kobj.metadata.name}`,
        `-o json`,
      ].join(' ')
    ),
    Effect.flatMap(({ stdout }) => Effect.try(() => JSON.parse(stdout))),
    Effect.flatMap((data) => {
      if (data.apiVersion === 'v1' && data.kind === 'List') {
        return Effect.succeed(data.items as Event[])
      }
      return Effect.succeed([] as Event[])
    })
  )

export const withRetry = (args: { attempts: number }) =>
  Effect.retry(
    pipe(
      Schedule.intersect(
        Schedule.recurs(args.attempts - 1),
        Schedule.exponential('500 millis', 2)
      ),
      Schedule.tapInput((x) =>
        Console.log(
          // @ts-ignore
          x?.stderr
        )
      ),
      Schedule.tapOutput((x) => {
        if (x[0] === args.attempts - 1) {
          return Console.log(
            `Retries exhausted after ${args.attempts} attempts`
          )
        }
        return Console.log(
          `Attempt ${
            x[0] + 2 // +2 because the first attempt is the initial attempt and is zero indexed
          } of ${args.attempts}. Retrying in ${Duration.toMillis(x[1])}ms`
        )
      })
    )
  )

export const getCurrentClusterContextName = () =>
  exec(`kubectl config view --minify -o jsonpath='{.clusters[].name}'`)
