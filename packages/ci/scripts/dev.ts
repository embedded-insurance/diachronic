import * as path from 'node:path'
import { Effect } from 'effect'
import { environmentFromEnv } from '@diachronic/toolbox/infra/environment'
import { devLoop } from '@diachronic/toolbox/infra/dev-loop'
import { BuildDeployMode } from '@diachronic/toolbox/infra/shared'
import { getVersionIdSync } from '@diachronic/toolbox/infra/versioning'
import { deployPipeline } from '@diachronic/toolbox/infra/pipeline'
import { filepathsOfDependentModules } from '@diachronic/toolbox/infra/dependencies'
import { buildSpec } from './build-spec'
import { makeCommands } from './commands'
import { getManifests } from './manifests'

// Print derived cli commands to execute activities, send signals/events, etc.
// given the workflow/activity definitions
const run = async () => {
  const mode: BuildDeployMode = 'interactive' as BuildDeployMode
  const cwd = process.cwd()
  const environment = environmentFromEnv('development')
  const versionId = getVersionIdSync(mode)
  const namespace = 'workflow-ci'

  // TODO. this should be part of the loop if only because
  // we may add dependencies while developing
  const packageName = '@diachronic/ci'
  const deps = await Effect.runPromise(filepathsOfDependentModules(packageName))

  await devLoop({
    environmentName: environment,
    filepaths: [...deps, `${cwd}/src/*.ts`],
    commands: makeCommands(),
    buildDeploy: () =>
      deployPipeline({
        environment,
        packageRoot: cwd,
        dockerfilePath: path.join(cwd, 'Dockerfile'),
        mode,
        name: 'workflowCI',
        namespace,
        versionId,
        getManifests,
        buildSpec,
      }),
  })
}

run()
