import { BuildDeployMode } from './shared'
import { getGitRepoRootSync } from './git'
import {
  dockerBuild,
  dockerPush,
  doesDockerImageExist,
  getDockerImageTag,
} from './docker'
import { kebabCase, snakeCase } from './string'
import { getVersionIdSync } from './versioning'
import * as path from 'path'
import { BuildSpec, compile, CompileConfig } from './build'
import { pipe } from 'effect/Function'
import { Effect } from 'effect'
import { ensureDir } from './file'
import { Environment, EnvironmentLayer } from './environment'
import { KubernetesManifest } from './manifests'
import {
  apply,
  saveManifests,
  waitForDeploymentRolloutComplete,
} from './kubernetes'
import { prettyLog, PrettyLogLayer } from './pretty-logger'

export const defaultPipelineSteps = {
  /**
   * Builds workflows and activities
   * Writes output to local filesystem
   * @param args
   */
  build: (args: {
    versionId: string
    buildDirectory: string
    spec: CompileConfig[]
  }) => {
    const outputDir = path.join(args.buildDirectory, args.versionId)
    return pipe(
      ensureDir(outputDir),
      Effect.tap(() => Effect.logDebug('Output directory exists ok')),
      Effect.flatMap(() =>
        compile({
          config: args.spec,
          versionId: args.versionId,
          outputDir,
        })
      )
    )
  },
}

export type GetManifestsInput = {
  namespace: string
  name: string
  versionId: string
  environment: Environment
  dockerImageIdent: string
}
export type GetManifestsFunction = (
  args: GetManifestsInput
) => Effect.Effect<Environment, unknown, KubernetesManifest[]>

export type DeployPipelineInput = {
  buildSpec: BuildSpec[]
  getManifests: GetManifestsFunction
  repoRoot?: string
  packageRoot?: string
  buildDirectoryRoot?: string
  mode?: BuildDeployMode
  versionId?: string
  namespace?: string
  name?: string
  environment?: Environment
  dockerfilePath?: string
  dockerImageTag?: string
}

/**
 * Deploys a workflow or activities to Kubernetes via Docker
 * @param args
 */
export const deployPipeline = (args: DeployPipelineInput) => {
  const name =
    args.name ||
    args.buildSpec.find((x) => x.type === 'workflow')?.name ||
    args.buildSpec.find((x) => x.type === 'activities')?.name ||
    args.buildSpec.find((x) => x.type === 'statechart')?.name
  if (!name) {
    console.error('No name or known build spec type', { args })
    throw new Error(
      `Provide "name" or "buildSpec" with type 'workflow' or 'activities'`
    )
  }
  const namespace = args.namespace || kebabCase(name)
  const environmentName = (args.environment ||
    process.env.DIACHRONIC_CLOUD_ENVIRONMENT ||
    'local') as Environment
  const monorepoRoot = args.repoRoot || getGitRepoRootSync()
  const packageRoot = args.packageRoot || process.cwd()
  const mode = args.mode || 'once'
  const versionId = args.versionId || getVersionIdSync(mode)

  // FIXME. deploying multiple versions or multiple workflows at once will mess this up.
  const dockerImageTag =
    args.dockerImageTag || getDockerImageTag(mode, versionId)
  const dockerImageName = snakeCase(name)
  const dockerArgs = {
    context: packageRoot,
    dockerfile:
      args.dockerfilePath || path.join(monorepoRoot, 'Dockerfile.temporal'),
    imageIdent: `us-docker.pkg.dev/diachronic/${dockerImageName}:${dockerImageTag}`,
    buildArgs: { VERSION_ID: versionId },
  }
  const buildDirectory =
    args.buildDirectoryRoot || path.join(packageRoot, 'dist')

  prettyLog({
    span: 'configuration',
    message: 'Using configuration',
    data: JSON.stringify(
      {
        name,
        environmentName,
        monorepoRoot,
        packageRoot,
        mode,
        versionId,
        dockerImageTag,
        dockerImageName,
        dockerArgs,
      },
      null,
      2
    ),
  })

  const getBuildStep = () => {
    return pipe(
      defaultPipelineSteps.build({
        versionId,
        buildDirectory,
        spec: args.buildSpec.map((x) => {
          switch (x.type) {
            case 'workflow':
              return {
                ...x,
                entrypoint:
                  x.entrypoint ||
                  require.resolve(path.join(packageRoot, 'src', 'workflow')),
              }
            case 'activities':
              return {
                ...x,
                entrypoint:
                  x.entrypoint ||
                  require.resolve(path.join(packageRoot, 'src', 'activities')),
              }
            case 'statechart':
              return {
                ...x,
                ref:
                  x.ref ||
                  require(path.join(
                    packageRoot,
                    './src/xstate/statechart'
                  )).createStateMachine({}),
              }
          }
        }),
      })
    )
  }

  return pipe(
    // Build workflows and/or activities
    pipe(
      getBuildStep(),
      // Fail on one or more errors
      Effect.flatMap((results) => {
        const errors = results.filter((x) => x._tag === 'Left')
        const successes = results.filter((x) => x._tag === 'Right')
        if (errors.length) {
          return pipe(
            Effect.logError('🛑 Build failed'),
            Effect.tap(() =>
              // @ts-ignore
              Effect.forEach(errors, (x) => Effect.logError(x.left))
            ),
            // Effect.annotateLogs(errors.map((x) => x.left)),
            Effect.flatMap(() => Effect.fail({ errors, successes }))
          )
        }
        return Effect.succeed({ errors, successes })
      }),
      Effect.withLogSpan('build-workflows-and-activities')
    ),

    // Build and push Docker image if it doesn't exist
    Effect.flatMap(() =>
      pipe(
        doesDockerImageExist(dockerArgs.imageIdent),
        Effect.tap((exists) => Effect.logInfo('Image exists: ' + exists)),
        Effect.flatMap((exists) =>
          Effect.if(exists, {
            onTrue: pipe(
              Effect.logInfo('Image already exists. Skipping build and push.'),
              Effect.flatMap(() => Effect.succeed(dockerArgs))
            ),
            onFalse: pipe(
              dockerBuild(dockerArgs),
              Effect.withLogSpan('docker-build'),
              Effect.flatMap(() => dockerPush(dockerArgs.imageIdent)),
              Effect.catchIf(
                (e) =>
                  e.stderr.includes(
                    'The repository has enabled tag immutability'
                  ),
                (e) =>
                  pipe(
                    Effect.logInfo('Ignoring tag exists'),
                    Effect.tap(() => Effect.succeed(e))
                  )
              ),
              Effect.withLogSpan('docker-push'),
              Effect.flatMap(() => Effect.succeed(dockerArgs))
            ),
          })
        ),
        Effect.withLogSpan('docker')
      )
    ),

    // Generate manifests for this version, plus any common resources
    Effect.bind('manifests', () =>
      pipe(
        args.getManifests({
          name,
          versionId,
          namespace,
          environment: environmentName,
          dockerImageIdent: dockerArgs.imageIdent,
        }),
        Effect.map((xs) =>
          environmentName === 'local'
            ? // Whitelist for local deployment resources
              // May be better as a blacklist (i.e. no crossplane)
              xs.filter(
                (x) =>
                  x.kind === 'Deployment' ||
                  x.kind === 'Namespace' ||
                  (x.kind === 'ServiceAccount' && x.apiVersion === 'v1')
              )
            : xs
        ),
        Effect.withLogSpan('manifests')
      )
    ),

    // Save manifests to filesystem, return their paths
    Effect.bind('writeManifests', ({ manifests }) =>
      pipe(
        saveManifests({
          cwd: packageRoot,
          manifests,
          environmentName,
          versionId,
        }),
        Effect.withLogSpan('write-manifests')
      )
    ),

    // Deploy manifests at filepaths
    Effect.bind('deploy', ({ writeManifests }) =>
      pipe(
        Effect.all(
          writeManifests.filepaths.map((desc) =>
            pipe(
              Effect.log('Deploying'),
              Effect.annotateLogs(desc),
              Effect.flatMap(() => apply(desc.path))
            )
          )
        ),
        Effect.withLogSpan('deploy')
      )
    ),

    Effect.let('deployments', ({ manifests }) =>
      // Find deployments to wait for
      manifests.filter(
        (x) => x.apiVersion === 'apps/v1' && x.kind === 'Deployment'
      )
    ),

    // Wait for deployment success
    Effect.tap(({ deployments }) => {
      return pipe(
        Effect.all(
          deployments.map((deployment) =>
            Effect.all(
              [
                // For each deployment wait until complete.
                // Simultaneously print the logs (may be from previous run...)
                // And any events that pertain to the deployment (these may show why it's taking a long time...like waiting for cluster to scale up)
                // TODO. Print / poll events for the pods in the deployments
                pipe(
                  waitForDeploymentRolloutComplete(deployment.metadata as any),
                  Effect.withLogSpan('awaiting-deployment-complete')
                ),
                // todo. we can try to stream logs here while deployment is rolling out,
                // becauae they will be availalbe (need to retry the streaming, maybe)
                // when attempts are exhausted we coudl fall back to starting them after rollout is complete
                // the dev loop may be the best place to manage stream resources
                // including "wait for rollout complete"

                // works but need to guarantee
                // we are targeting a pod in the new deployment
                // pipe(
                //   getLogs(deployment.metadata as any),
                //   withRetry({ attempts: 5 }),
                //   Effect.flatMap((a) => Console.log(a))
                // ),
              ] as const,
              { concurrency: 'unbounded' }
            )
          )
        )
      )
    }),

    Effect.provide(EnvironmentLayer(environmentName)),
    Effect.provide(PrettyLogLayer('Debug')),
    Effect.runPromise
  )
}
