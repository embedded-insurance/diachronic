import { Effect } from 'effect'
import { environmentFromEnv } from '@diachronic/toolbox/infra/environment'
import { devLoop } from '@diachronic/toolbox/infra/dev-loop'
import { getManifests } from './manifests'
import { filepathsOfDependentModules } from '@diachronic/toolbox/infra/dependencies'
import { createReloadableWorkerPipeline } from '@diachronic/toolbox/infra/reload-pipeline'
import { buildSpec } from './build-spec'
import { makeCommands } from './commands'

const run = async () => {
  const packageName = require('./../package.json').name
  const cwd = process.cwd()
  const environmentName = environmentFromEnv('development')

  const deps = await Effect.runPromise(
    // TODO. this should be part of the loop if only because
    // we may add dependencies while developing
    filepathsOfDependentModules(packageName)
  )

  const reloadImageName = 'workflow_ci_reload'
  const reloadImageTag = 'v1'
  const reloadDockerImageIdent = `us-docker.pkg.dev/diachronic/${reloadImageName}:${reloadImageTag}`

  await devLoop({
    environmentName,
    commands: makeCommands(),
    buildDeploy: createReloadableWorkerPipeline({
      reloadDockerImageIdent,
      environment: environmentName,
      mode: 'interactive',
      getManifests,
      buildSpec,
    }),
    filepaths: [...deps, `${cwd}/src/**/*.ts`],
  })
}

run()
