import * as R from 'ramda'
import * as HTTPClient from '@effect-use/http-client'
import { Context, Effect, Layer, pipe } from 'effect'
import * as S from '@effect/schema/Schema'
import { ErrorResponse } from '@effect-use/http-client'
import { workflowTaskQueueName } from './versioning'
import { WorkflowVersionInfo } from './versioning-types'

// assumes 1 unleash server per cloud env
// Each instance uses the unleash "production" environment
export const FeatureFlagEnvironment = S.Union(S.Literal('production'), S.String)
export type FeatureFlagEnvironment = S.Schema.Type<
  typeof FeatureFlagEnvironment
>

export const incrementSeqId = (seqId: string) => {
  const nextSeqId = (parseInt(seqId) + 1).toString().padStart(3, '0')
  if (Number.isNaN(parseInt(nextSeqId))) {
    throw new Error('Invalid sequence id: ' + nextSeqId)
  }
  return nextSeqId
}

/**
 * The string used to identify a feature flag for a workflow version
 * @param workflowName
 * @param versionId
 * @param seqId
 */
export const workflowVersionFlagName = (
  workflowName: string,
  versionId: string,
  seqId: string
) => `workflow.${workflowName}.seqId.${seqId}.version.${versionId}`

/**
 * Returns the data encoded in a workflow version feature flag name
 * @param flagName
 */
export const getWorkflowFlagParts = (flagName: string) => {
  const [
    _workflowFlagNamespace,
    workflowName,
    _seqKey,
    seqId,
    _versionIdKey,
    versionId,
  ] = flagName.split('.')
  return { workflowName, seqId, versionId }
}

export type FlagStrategy = {
  id: string
  name: string
  title: string
  disabled: boolean
  featureName?: string
  sortOrder?: number
  segments: number[]
  constraints: {
    contextName: string
    operator: string
    caseInsensitive: boolean
    inverted: boolean
    values: string[]
    // value: string
  }[]
  variants: {
    name: string
    weight: number
    weightType: string
    stickiness: string
    payload: {
      type: string
      value: string
    }
  }[]
  parameters: {
    rollout: string
    stickiness: 'default' | 'sessionId' | string
    groupId: string
  }
}

export type ListFlagsOutput = {
  version: number
  features: {
    name: string
    type: string
    enabled: boolean
    project: string
    stale: boolean
    strategies: {
      name: string
      constraints: {
        values: string[]
        inverted: boolean
        operator: string
        contextName: string
        caseInsensitive: boolean
      }[]
      parameters: {
        groupId: string
        rollout: string
        stickiness: string
      }
      variants: unknown[]
    }[]
    variants: unknown[]
    description: string
    impressionData: boolean
  }[]
  query: {
    project: string[]
    namePrefix: string
    environment: string
    inlineSegmentConstraints: boolean
  }
  meta: {
    revisionId: number
    etag: string
    queryHash: string
  }
}

const withErrorData = Effect.catchTags({
  ErrorResponse: (httpError: ErrorResponse) =>
    pipe(
      Effect.tryPromise({
        try: () => httpError.response.json(),
        catch: () => Effect.fail(httpError),
      }),
      Effect.flatMap((data) => {
        ;(httpError as ErrorResponse & { data: unknown }).data = data
        return Effect.fail(httpError)
      })
    ),
})

export type FeatureFlagConfigClientArgs = {
  apiKey: string
  serverURL?: string
  defaults?: { environment?: string; project?: string }
}
/**
 * Creates a client for the feature flag admin API
 * @param config
 */
export const makeFeatureFlagConfigClient = (
  config: FeatureFlagConfigClientArgs
) => {
  const client = pipe(
    HTTPClient.make({
      baseURL: (config.serverURL || 'http://localhost:4242') + '/api/admin',
      headers: {
        'Content-Type': 'application/json',
        Authorization: config.apiKey,
      },
    }),
    Effect.provideService(HTTPClient.Fetch, fetch),
    Effect.runSync
  )

  const defaultProject = config.defaults?.project || 'default'
  const defaultEnvironment = config.defaults?.environment || 'production'

  /**
   * Lists flags in {environment} with name starting with {namePrefix}
   * @param args
   */
  const listFlagsByPrefix = (args: {
    namePrefix: string
    project: string
    environment?: string
  }) =>
    pipe(
      client.get({
        path: `/features?${new URLSearchParams({
          ...args,
          environment: args.environment || defaultEnvironment,
        })}`,
      }),
      Effect.flatMap((x) =>
        Effect.tryPromise(() => x.json() as Promise<ListFlagsOutput>)
      )
    )

  return {
    /**
     * Plain http client pre-configured with the API key and base URL
     */
    api: client,

    /**
     * Used when not passed as arguments to specific methods
     * Values used for defaults may be passed to the constructor and default to 'default' and 'production'.
     */
    defaults: { project: defaultProject, environment: defaultEnvironment },
    /**
     * Enables a flag
     * By default flags are disabled on creation
     * @param args
     */
    enableFlag: (args: {
      flagName: string
      projectId?: string
      environment?: FeatureFlagEnvironment | undefined
    }) =>
      client.post({
        path: `/projects/${args.projectId || defaultProject}/features/${
          args.flagName
        }/environments/${args.environment || defaultEnvironment}/on`,
      }),

    // https://docs.getunleash.io/reference/api/legacy/unleash/admin/features-v2#archive-toggle
    archiveFlag: (args: { flagName: string; projectId?: string }) =>
      client.delete({
        path: `/projects/${args.projectId || defaultProject}/features/${
          args.flagName
        }`,
      }),

    /**
     * Creates a new flag
     * @param args
     */
    createFlag: (args: {
      type: 'release' | 'operational'
      name: string
      description: string
      impressionData: boolean
      projectId?: string
      environment?: FeatureFlagEnvironment | undefined
    }) =>
      client.post({
        path: `/projects/${args.projectId || defaultProject}/features`,
        body: JSON.stringify({
          ...args,
          environment: args.environment || defaultEnvironment,
        }),
      }),

    /**
     * Clones `flagName` to `newName`
     * @param args
     */
    clone: (args: {
      projectId: string
      flagName: string
      newName: string
      replaceGroupId: boolean
    }) =>
      client.post({
        path: `/projects/${args.projectId || defaultProject}/features/${
          args.flagName
        }/clone`,
        body: JSON.stringify({ name: args.newName }),
      }),

    getFlagStrategies: (args: {
      flagName: string
      environment?: string | undefined
      projectId?: string
    }) =>
      pipe(
        client.get({
          path: `/projects/${args.projectId || defaultProject}/features/${
            args.flagName
          }/environments/${args.environment || defaultEnvironment}/strategies`,
        }),
        Effect.flatMap((x) =>
          Effect.tryPromise(() => x.json() as Promise<FlagStrategy[]>)
        )
      ),

    restoreArchivedFlag: (args: { flagName: string }) =>
      pipe(
        client.post({ path: `/archive/revive/${args.flagName}` }),
        withErrorData,
        Effect.flatMap((x) =>
          Effect.tryPromise(() => x.json() as Promise<unknown>)
        )
      ),

    /**
     * Returns all flags for workflow versioning in {environment} for {workflowName}
     * Results are returned in descending order by name by default
     * @param args
     */
    getWorkflowFlags: (args: {
      workflowName: string
      project?: string
      environment?: string | undefined
    }) =>
      pipe(
        listFlagsByPrefix({
          namePrefix: `workflow.${args.workflowName}`,
          project: args.project || defaultProject,
          environment: args.environment || defaultEnvironment,
        }),
        Effect.map((x) =>
          pipe(
            x.features.filter((x) => {
              const { workflowName } = getWorkflowFlagParts(x.name)
              return workflowName === args.workflowName
            }),
            R.sort(R.descend(R.prop('name')))
          )
        )
      ),
  }
}

export type FeatureFlagConfigClient = ReturnType<
  typeof makeFeatureFlagConfigClient
>
export const FeatureFlagConfigClient =
  Context.GenericTag<FeatureFlagConfigClient>('diachronic.flags.config')

export const makeFeatureFlagConfigClientLayer = (
  args: FeatureFlagConfigClientArgs
) =>
  Layer.sync(FeatureFlagConfigClient, () => makeFeatureFlagConfigClient(args))

const exampleTestStrategy = (args: {
  workflowFlagName: string
  percent: string
}) => ({
  name: 'flexibleRollout',
  title: 'Dark Deploy Strategy',
  constraints: [
    {
      contextName: 'isTest',
      operator: 'IN',
      values: ['true'],
      caseInsensitive: false,
      inverted: false,
    },
  ],
  parameters: {
    rollout: args.percent,
    stickiness: 'default',
    groupId: args.workflowFlagName,
  },
  variants: [],
  segments: [],
  disabled: false,
})

const generalTrafficStrategy = (args: {
  percent: string
  workflowFlagName: string
}) => ({
  name: 'flexibleRollout',
  title: 'All other traffic',
  constraints: [],
  parameters: {
    rollout: args.percent,
    stickiness: 'default', // todo. orgId | sessionId | default | random?
    groupId: args.workflowFlagName,
  },
  variants: [],
  segments: [],
  disabled: false,
})

/**
 * Deletes a feature flag for a workflow version
 * @param args
 */
export const deleteWorkflowVersionFlag = (args: {
  workflowName: string
  versionId: string
}) =>
  Effect.flatMap(FeatureFlagConfigClient, (client) =>
    pipe(
      client.getWorkflowFlags({ workflowName: args.workflowName }),
      Effect.withLogSpan('getWorkflowFlags'),
      Effect.flatMap((xs) => {
        const results = xs.filter((x) => x.name.endsWith(args.versionId))
        if (!results.length) {
          return pipe(
            Effect.logDebug('No flags found'),
            Effect.annotateLogs({
              flags: results,
              workflowName: args.workflowName,
              versionId: args.versionId,
            }),
            Effect.flatMap(() =>
              Effect.fail(
                `No flags found for workflow ${args.workflowName} version ${args.versionId}. Expected exactly 1.`
              )
            )
          )
        }
        if (results.length > 1) {
          return pipe(
            Effect.logDebug('Multiple flags found'),
            Effect.annotateLogs({
              flags: results,
              workflowName: args.workflowName,
              versionId: args.versionId,
            }),
            Effect.flatMap(() =>
              Effect.fail(
                `Multiple flags found for workflow ${args.workflowName} version ${args.versionId}. Expected exactly 1.`
              )
            )
          )
        }
        return Effect.succeed(results[0])
      }),
      Effect.tap((flag) =>
        pipe(
          client.archiveFlag({ flagName: flag.name }),
          Effect.withLogSpan('archiveFlag')
        )
      ),
      Effect.map((flag) => ({ flagName: flag.name }))
    )
  )

type FlagStrategyIdent = { name: string; title: string }

const flagStrategyIdent = (
  x: FlagStrategyIdent | Omit<FlagStrategy, 'id' | 'featureName'>
) => `${x.name}/${x.title}`

export const applyFlagStrategy = (args: {
  flagName: string
  strategy: Omit<FlagStrategy, 'id' | 'featureName'>
  environment?: string | undefined
  projectId?: string
}) =>
  Effect.flatMap(FeatureFlagConfigClient, (client) =>
    pipe(
      client.getFlagStrategies({
        flagName: args.flagName,
        environment: args.environment,
      }),
      Effect.flatMap((x) => {
        const strategy = x.find(
          (x) => flagStrategyIdent(x) === flagStrategyIdent(args.strategy)
        )
        if (!strategy) {
          return pipe(
            // todo. add to the client itself
            client.api.post({
              path: `/projects/${
                args.projectId || client.defaults.project
              }/features/${args.flagName}/environments/${
                args.environment || client.defaults.environment
              }/strategies`,
              body: JSON.stringify(args.strategy),
            }),
            withErrorData,
            Effect.map((x) => ({ flagName: args.flagName }))
          )
        }
        return pipe(
          // todo. add to the client itself
          client.api.put({
            // fully replaces the strategy
            // https://docs.getunleash.io/reference/api/unleash/update-feature-strategy
            path: `/projects/${
              args.projectId || client.defaults.project
            }/features/${args.flagName}/environments/${
              args.environment || client.defaults.environment
            }/strategies/${strategy.id}`,
            body: JSON.stringify(args.strategy),
          }),
          withErrorData,
          Effect.map((x) => ({ flagName: args.flagName }))
        )
      })
    )
  )

export const applyWorkflowTrafficRouting = (args: {
  workflowFlagName: string
  percent: string
  projectId?: string
  environment?: FeatureFlagEnvironment | undefined
}) =>
  applyFlagStrategy({
    flagName: args.workflowFlagName,
    environment: args.environment,
    strategy: generalTrafficStrategy({
      percent: args.percent,
      workflowFlagName: args.workflowFlagName,
    }),
  })

/**
 * Creates a feature flag for a workflow version
 * Runs on a new workflow version creation
 * Returns the version information of the flag
 * @param args
 */
export const applyWorkflowVersionFlag = (args: {
  workflowName: string
  versionId: string
  environment?: FeatureFlagEnvironment | undefined
}) =>
  Effect.flatMap(FeatureFlagConfigClient, (client) =>
    pipe(
      client.getWorkflowFlags({
        workflowName: args.workflowName,
        environment: args.environment,
      }),
      Effect.flatMap(
        (flags): Effect.Effect<WorkflowVersionInfo, unknown, any> => {
          const workflowFlagData = flags.map((x) =>
            getWorkflowFlagParts(x.name)
          )
          const existingFlagForVersionId = workflowFlagData.find(
            (x) => x.versionId === args.versionId
          )
          let seqId: string
          if (existingFlagForVersionId) {
            seqId = existingFlagForVersionId.seqId
          } else {
            const mostRecentFlag = R.head(workflowFlagData)
            if (mostRecentFlag) {
              seqId = incrementSeqId(mostRecentFlag.seqId)
            } else {
              seqId = '000'
            }
          }
          const flagName = workflowVersionFlagName(
            args.workflowName,
            args.versionId,
            seqId
          )
          const versionInfo: WorkflowVersionInfo = {
            environment: args.environment,
            taskQueue: workflowTaskQueueName({
              workflowName: args.workflowName,
              versionId: args.versionId,
            }),
            flagName,
            ...getWorkflowFlagParts(flagName),
          }
          return Effect.if(!!existingFlagForVersionId, {
            onTrue: () => Effect.succeed(versionInfo),
            onFalse: () =>
              pipe(
                client.createFlag({
                  type: 'release',
                  projectId: 'default',
                  environment: args.environment,
                  name: flagName,
                  description:
                    'Determines whether users get this version of workflow.',
                  impressionData: true,
                }),
                Effect.catchTags({
                  ErrorResponse: (e) =>
                    Effect.if(e.statusCode === 409, {
                      onFalse: () => Effect.fail(e),
                      onTrue: () =>
                        pipe(
                          Effect.logWarning(`Flag already exists.`),
                          Effect.tap(() =>
                            pipe(
                              Effect.logInfo(`Attempting to unarchive flag.`),
                              Effect.flatMap(() =>
                                pipe(
                                  // todo. consider whether all strategies
                                  // should be deleted. if flag was created only
                                  // by this api it shouldn't make a difference since they'll be
                                  // applied below
                                  client.restoreArchivedFlag({ flagName }),
                                  Effect.tap(() =>
                                    Effect.logInfo(`Flag restored.`).pipe(
                                      Effect.annotateLogs(versionInfo)
                                    )
                                  ),
                                  Effect.tapErrorCause((e) =>
                                    Effect.logError('Failed to restore flag', e)
                                  )
                                )
                              )
                            )
                          )
                        ),
                    }),
                }),
                Effect.map(() => versionInfo),
                Effect.withLogSpan('createFlag')
              ),
          })
        }
      ),
      Effect.tap(({ flagName }) =>
        pipe(
          applyFlagStrategy({
            flagName,
            environment: args.environment,
            strategy: exampleTestStrategy({
              workflowFlagName: flagName,
              percent: '100',
            }),
          }),
          Effect.withLogSpan('testStrategy')
        )
      ),
      Effect.tap(({ flagName }) =>
        pipe(
          applyFlagStrategy({
            flagName,
            environment: args.environment,
            strategy: generalTrafficStrategy({
              percent: '0',
              workflowFlagName: flagName,
            }),
          }),
          Effect.withLogSpan('generalTrafficStrategy')
        )
      ),
      Effect.tap(({ flagName }) =>
        pipe(
          client.enableFlag({
            projectId: 'default',
            environment: args.environment,
            flagName,
          }),
          Effect.withLogSpan('enableFlag')
        )
      )
    )
  )
