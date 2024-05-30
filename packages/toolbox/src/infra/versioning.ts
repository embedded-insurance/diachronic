import { BuildDeployMode } from './shared'
import * as S from '@effect/schema/Schema'
import { getGitBranchSync, getGitShaShortSync } from './git'

export const makeTimestampVersionId = () =>
  new Date().toISOString().toLowerCase().replace(/:/g, '-').replace(/\./g, '-')

export const WorkflowTaskQueueParts = S.Tuple(
  S.String.pipe(S.identifier('workflowName')),
  S.String.pipe(S.identifier('versionId'))
)

/**
 * Computes the name of workflow task queue
 * @param workflowName
 * @param versionId
 */
export const workflowTaskQueueName = ({
  workflowName,
  versionId,
}: {
  workflowName: string
  versionId: string
}) => [workflowName, versionId].join('-')

/**
 * Returns the version id we use by default givne the build deploy mode
 * @param mode
 */
export const getVersionIdSync = (mode: BuildDeployMode) =>
  mode === 'once' ? getGitShaShortSync() : getGitBranchSync()
