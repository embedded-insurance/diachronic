import * as R from 'ramda'
import { pipe } from 'effect/Function'
import { Effect } from 'effect'
import { expandHomedir, resolveFilepath } from './file'
import { makeTimestampVersionId } from './versioning'
import { BuildDeployMode } from './shared'
import { exec } from './util'

/**
 * Static Docker build configuration
 */
export type DockerBuildConfig = {
  context: string
  imageRepo: string
  imageName: string
  dockerfile: string
}
export type DockerBuildArgs = {
  context: string
  imageIdent: string
  buildArgs: { VERSION_ID: string }
  secrets?: { id: string; src: string }[]
  dockerfile: string
}

const forwardSTDIO = { stderr: true, stdout: true }

export const secrets = (xs: { id: string; src: string }[]): string[] =>
  xs.map(({ id, src }) => `--secret id=${id},src=${expandHomedir(src)}`)

export const buildArgs = (m: Record<string, string>): string[] =>
  Object.entries(m).map(([k, v]) => `--build-arg="${k}=${v}"`)

// Where s is docker build output from stderr or whatever it uses
const getSHA256FromBuildOutput = (s: string) => {
  const sha256 = R.takeWhile(
    (c) => c !== ' ' && c !== '\n',
    // @ts-expect-error
    R.last(s.split('sha256:'))?.split('')
  )
  if (sha256?.length) {
    return `sha256:${sha256.join('')}`
  }
  return null
}

export const doesDockerImageExist = (
  imageIdent: string
): Effect.Effect<boolean> => {
  const dockerImageExistsCmd = `docker manifest inspect ${imageIdent}`

  return pipe(
    Effect.logTrace(dockerImageExistsCmd),
    Effect.flatMap(() => exec(dockerImageExistsCmd)),
    Effect.matchEffect({
      onSuccess: () => Effect.succeed(true),
      onFailure: () => Effect.succeed(false),
    })
  )
}

export const dockerBuild = (args: DockerBuildArgs, cwd?: string) => {
  const dockerBuildCmd = [
    `DOCKER_BUILDKIT=1`,
    `docker build`,
    ...secrets(args.secrets || []),
    ...buildArgs(args.buildArgs),
    `-f ${resolveFilepath(args.dockerfile, cwd)}`,
    `-t ${args.imageIdent}`,
    `${args.context}`,
  ].join(' ')
  return pipe(
    Effect.logDebug(dockerBuildCmd),
    Effect.flatMap(() => exec(dockerBuildCmd, undefined, forwardSTDIO)),
    Effect.map((args) => {
      const sha256 = getSHA256FromBuildOutput(args.stderr || args.stdout)
      return { ...args, sha256 }
    })
  )
}

export const dockerPush = (imageIdent: string) => {
  const dockerPushCmd = [`docker push`, imageIdent].join(' ')
  return pipe(
    Effect.logDebug(dockerPushCmd),
    Effect.flatMap(() => exec(dockerPushCmd, undefined, forwardSTDIO))
  )
}

/**
 * Returns the appropriate docker image tag given the build deploy mode
 * @param mode
 * @param versionId
 */
export const getDockerImageTag = (mode: BuildDeployMode, versionId: string) =>
  mode === 'interactive'
    ? // Immutable docker registries won't let us upload with the same tag,
      // so we add a timestamp in interactive mode as we allow this version id
      // to have more than one build associated with it
      versionId + '_' + makeTimestampVersionId()
    : versionId
