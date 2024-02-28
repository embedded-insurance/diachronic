import * as R from 'ramda'
import { Effect, pipe } from 'effect'

type RegistryEntry = {
  appName: string
  workflowTypes: string[]
  githubAction: string
  nonMigratoryWorkflows?: []
}

const registry = [
  {
    appName: 'example',
    workflowTypes: ['example'],
    githubAction: '.github/workflows/example.yaml',
  },
] as Array<RegistryEntry>

/**
 * Should be run as part of a build script
 * @param reg
 */
export const assertUniqueWorkflowTypes = (reg: Array<RegistryEntry>) => {
  const workflowTypes = reg.flatMap((a) =>
    a.workflowTypes.map((x) => ({
      appName: a.appName,
      workflowType: x,
    }))
  )
  const byType = R.groupBy((a) => a.workflowType, workflowTypes)
  const dups = Object.entries(byType)
    .filter(([_, v]) => v!.length > 1)
    .map((x) => x[1])
  if (dups.length) {
    throw new Error('Found duplicate workflow types: ' + JSON.stringify(dups))
  }
}

/**
 * Presumes all workflowType in registry are unique across deployments
 * Returns workflowType as the default value when not found
 * @param workflowType
 * @param defaultValue
 * @param reg
 */
export const getWorkflowDeploymentNameFromWorkflowType = (
  workflowType: string,
  defaultValue: string,
  reg: RegistryEntry[] = registry
) => {
  try {
    const workflowTypesToAppName = R.map(
      // @ts-expect-error
      (x) => x.appName,
      R.indexBy(
        R.prop('workflowType'),
        reg.flatMap((a) =>
          a.workflowTypes.map((x) => ({
            appName: a.appName,
            workflowType: x,
          }))
        )
      )
    )

    const appName = workflowTypesToAppName[workflowType]

    return Effect.if(appName !== undefined, {
      onTrue: Effect.succeed(appName),
      onFalse: pipe(
        Effect.logWarning(
          `No mapping for workflow type ${workflowType}. Using default value.`
        ),
        Effect.tap(() => Effect.succeed(defaultValue))
      ),
    })
  } catch (e) {
    console.error('getWorkflowDeploymentNameFromWorkflowType error', e)
    return Effect.succeed(defaultValue)
  }
}

export const gitHubActionToWorkflowDeploymentName = (ghAction: string) => {
  const entry = registry.find((x) => x.githubAction === ghAction)
  if (!entry) {
    return undefined
  }
  return entry.appName
}

export const getNonmigratoryDeployments = () =>
  registry.filter((x) => x.nonMigratoryWorkflows?.length).map((x) => x.appName)

export const isDarkDeploy = (workflowName: string) => true
