import * as path from 'node:path'
import { environmentFromEnv } from '@diachronic/toolbox/infra/environment'
import { deployPipeline } from '@diachronic/toolbox/infra/pipeline'
import { getVersionIdSync } from '@diachronic/toolbox/infra/versioning'
import { getManifests } from './manifests'

const cwd = process.cwd()
deployPipeline({
  name: 'workflowCI',
  mode: 'once',
  versionId: 'workflow-ci',
  environment: environmentFromEnv(),
  namespace: 'workflow-ci',
  dockerfilePath: path.join(cwd, 'Dockerfile'),
  dockerImageTag: getVersionIdSync('once'),
  getManifests,
  buildSpec: [
    {
      type: 'workflow',
      name: 'workflowCI',
      ignoreModules: ['@temporalio/client', 'events', 'fs', 'child_process'],
    },
    {
      type: 'activities',
      name: 'workflowCI',
    },
  ],
})
