import { Context, Effect, pipe } from 'effect'
import { isEnabled, startUnleash } from 'unleash-client'
import * as R from 'ramda'
import * as Layer from 'effect/Layer'
import {
  workflowTaskQueueName,
  WorkflowTaskQueueParts,
} from '@diachronic/toolbox/infra/versioning'
import * as S from '@effect/schema/Schema'
import { getWorkflowFlagParts } from '@diachronic/toolbox/infra/feature-flag-config'
import { getWorkflowDeploymentNameFromWorkflowType } from '@diachronic/toolbox/repo-metadata'

export const makeFeatureFlagClient = async (args: {
  serverURL: string
  apiKey: string
}) => {
  const sdk = await startUnleash({
    // Name that will display in the Unleash UI and metrics
    appName: 'diachronic.feature-flag-client',
    url: args.serverURL + '/api',
    metricsInterval: 2000,
    refreshInterval: 1000,
    customHeaders: {
      Authorization: args.apiKey,
    },
    // We don't get a project that isn't "default" right now
    // An invalid value in this field breaks everything silently.
    // projectName appears to be projectId or project.
    // projectName: 'default',

    // From the docs:
    // > The value to put in the Unleash context's `environment` property. Automatically
    //   populated in the Unleash Context (optional). This does **not** set the SDK's
    //   [Unleash environment](https://docs.getunleash.io/reference/environments).
    // We don't know what Unleash context's "environment" property means at this time.
    // environment: 'development',
  })

  // sdk.on('error', e=>console.error("Unleash SDK error",e))
  // sdk.on('warn', console.warn)
  // sdk.on('changed', (what) => console.log('Feature flag sdk change', what))
  // sdk.on('ready', () => console.log('SDK says ready.'))
  // sdk.on('synchronized', (a) =>
  //   console.log('SDK is synchronized with the server', a || '')
  // )

  const getWorkflowFlags = (args: { workflowName: string }) =>
    Effect.try(() =>
      sdk.getFeatureToggleDefinitions().filter((x) => {
        const { workflowName } = getWorkflowFlagParts(x.name)
        return workflowName === args.workflowName
      })
    )
  return {
    sdk,
    /**
     * Returns all flags for a workflow in the environment the sdk is connected to
     * @param args
     */
    getWorkflowFlags,

    /**
     * Returns the task queue that the user should start on for a workflow
     * @param args
     */
    getWorkflowTaskQueue: (args: {
      workflowName: string
      context: { userId: string; orgId?: string }
      defaultValue: string
    }) =>
      pipe(
        getWorkflowDeploymentNameFromWorkflowType(
          args.workflowName,
          args.defaultValue
        ),
        Effect.flatMap((workflowDeploymentName) =>
          getWorkflowFlags({ workflowName: workflowDeploymentName })
        ),
        Effect.map((results) => {
          // Just get a list of flag names since all data we use is in the names/keys
          const flagNames = results.map((x) => x.name)

          // Sort descending because we want the latest (presumes order has been encoded in name, like
          // workflow.myworkflow.seqid.1.version-id.fj3ah)
          const ordered = R.sort(R.descend(R.identity), flagNames)

          const enabledTaskQueueFlagName = ordered.find((x) =>
            isEnabled(x, {
              userId: args.context.userId as any,
              properties: R.omit(['userId'], args.context),
            })
          )

          return enabledTaskQueueFlagName || args.defaultValue
        }),
        Effect.flatMap((flagName) => {
          // workflow.myworkflow.seqid.001.version-id.fj3ah
          const [
            _flagType,
            workflowDeploymentName,
            _seqKey,
            seqId,
            _versionKey,
            version,
          ] = flagName.split('.')

          return pipe(
            S.decodeUnknown(WorkflowTaskQueueParts)(
              [workflowDeploymentName, version],
              {
                errors: 'all',
              }
            ),
            Effect.map(([workflowDeploymentName, versionId]) =>
              workflowTaskQueueName({
                workflowName: workflowDeploymentName,
                versionId,
              })
            )
          )
        }),
        Effect.catchAllCause((e) =>
          pipe(
            Effect.logError(
              `Error getting workflow task queue for workflow ${args.workflowName}`,
              e
            ),
            Effect.flatMap(() => Effect.succeed(args.defaultValue))
          )
        )
      ),
  }
}

export type FeatureFlagClient = Awaited<
  ReturnType<typeof makeFeatureFlagClient>
>
export const FeatureFlagClient = Context.Tag<FeatureFlagClient>(
  'diachronic.feature-flag-client'
)
/**
 * A FeatureFlagClient that always returns the default value
 */
export const FeatureFlagClientAllDefaults = FeatureFlagClient.of({
  sdk: {} as any,
  getWorkflowFlags: () => Effect.succeed([]),
  getWorkflowTaskQueue: ({ defaultValue }: any) => Effect.succeed(defaultValue),
})

export const makeFeatureFlagClientLayer = (args: {
  serverURL: string
  apiKey: string
  fallbackToDefaultsForEverythingOnClientConstructionFailure?: boolean
}) =>
  Layer.effect(
    FeatureFlagClient,
    pipe(
      Effect.tryPromise(() => makeFeatureFlagClient(args)),
      Effect.matchCauseEffect(
        args.fallbackToDefaultsForEverythingOnClientConstructionFailure
          ? {
              onSuccess: Effect.succeed,
              onFailure: (e) =>
                pipe(
                  Effect.logError('Error creating feature flag client', e),
                  Effect.flatMap(() =>
                    Effect.succeed(FeatureFlagClientAllDefaults)
                  )
                ),
            }
          : { onSuccess: Effect.succeed, onFailure: Effect.failCause }
      )
    )
  )

/**
 * Provides a feature flag client that always returns the default value
 * @param args
 */
export const makeFeatureFlagClientLayerTest = (args: {
  serverURL: string
  apiKey: string
}) => Layer.succeed(FeatureFlagClient, FeatureFlagClientAllDefaults)
