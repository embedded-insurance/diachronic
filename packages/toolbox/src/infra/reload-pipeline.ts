import {
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Match,
  pipe,
  Queue,
  Scope,
} from 'effect'
import { prettyLog, PrettyLogLayer } from './pretty-logger'
import {
  DiachronicCloudEnvironment,
  Environment,
  EnvironmentLayer,
} from './environment'
import {
  apply,
  getCurrentClusterContextName,
  saveManifests,
  waitForDeploymentRolloutComplete,
} from './kubernetes'
import { defaultPipelineSteps, GetManifestsFunction } from './pipeline'
import { kebabCase } from './string'
import { getGitRepoRootSync } from './git'
import { getVersionIdSync } from './versioning'
import * as path from 'path'
import {
  MQTTClient,
  MQTTLive,
} from '@diachronic/workflow-request-response/mqtt'
import * as os from 'os'
import * as R from 'ramda'
import { BuildSpec } from './build'
import { BuildDeployMode } from './shared'
import { GCS, getPresignedUrl, makeGCSLiveLayer } from '@effect-use/gcp-gcs'
import * as fs from 'fs'
import { tar } from './tar'
import { finished } from 'node:stream/promises'
import { RuntimeFiber } from 'effect/Fiber'
import * as S from '@effect/schema/Schema'
import { exec } from './util'
import { MessageType, Reload } from '@diachronic/workflow/reload-worker/api'
// import { Deployment } from '@ei-tech/k8s-api/v1/Deployment'
// import { Service } from '@ei-tech/k8s-core/v1/Service'
type Deployment = any
type Service = any

// FIXME.
const BUCKET_NAME = 'diachronic-temporal-bundles'
const RELOAD_IMAGE_NAME = 'reload-worker'
const RELOAD_IMAGE_TAG = 'v1'

const environmentToClusterName = {
  development: ['minikube'],
  production: [] as string[],
} satisfies Record<DiachronicCloudEnvironment, string[]>

export class WrongClusterContextError extends S.TaggedError<WrongClusterContextError>()(
  'WrongClusterContextError',
  {
    actual: S.String,
    environment: DiachronicCloudEnvironment,
    expected: S.optional(S.Array(S.String)),
  }
) {}

const ensureKubectxForEnvironment = (environment: DiachronicCloudEnvironment) =>
  pipe(
    getCurrentClusterContextName(),
    Effect.map((x) => x.stdout),
    Effect.filterOrFail(
      (name) => environmentToClusterName[environment].includes(name),
      (name) =>
        new WrongClusterContextError({
          environment: environment,
          actual: name,
          expected: environmentToClusterName[environment],
        })
    )
  )

const pfspecs = {
  mqtt: { name: 'broker', namespace: 'mqtt', port: 1883, targetPort: 1883 },
  signaler: {
    name: 'workflow-signaler',
    namespace: 'workflow-signaler',
    port: 8080,
    targetPort: 8080,
  },
  temporal: {
    name: 'temporal-frontend',
    namespace: 'temporal',
    port: 7233,
    targetPort: 7233,
  },
}

type Svc = 'mqtt' | 'signaler' | 'temporal'
const isPortForwarding = (service: Svc) => {
  const spec = pfspecs[service]
  return pipe(
    exec(`kubectl get svc/${spec.name} -n ${spec.namespace} -o json`),
    Effect.map((s) => JSON.parse(s.stdout) as Service),
    Effect.map(
      (svc) =>
        !!svc.spec?.ports?.some(
          (x: any) =>
            x.port === spec.port &&
            String(x?.targetPort) === String(spec.targetPort)
        )
    )
  )
}

const portForward = (environment: DiachronicCloudEnvironment, service: Svc) =>
  pipe(
    ensureKubectxForEnvironment(environment),
    Effect.flatMap(() => isPortForwarding(service)),
    Effect.flatMap((alreadyPortforwarding) =>
      Effect.if(alreadyPortforwarding, {
        onTrue: () =>
          pipe(
            Effect.logDebug(`Already port-forwarding to ${service} service`),
            Effect.tap(() => Effect.succeed(Effect.void))
          ),
        onFalse: () =>
          pipe(
            Match.value(service),
            Match.when('mqtt', () =>
              pipe(
                Effect.logInfo(
                  `Starting port forward to ${environment} MQTT service on port 1883`
                ),
                Effect.flatMap(() =>
                  exec(`kubectl port-forward svc/broker 1883:1883 -n mqtt`)
                )
              )
            ),
            Match.when('signaler', () =>
              pipe(
                Effect.logInfo(
                  `Starting port forward to ${environment} signaler service on port 8080`
                ),
                Effect.flatMap(() =>
                  exec(
                    `kubectl port-forward svc/workflow-signaler 8080:8080 -n workflow-signaler`
                  )
                )
              )
            ),
            Match.when('temporal', () =>
              pipe(
                Effect.logInfo(
                  `Starting port forward to ${environment} temporal service on port 7233`
                ),
                Effect.flatMap(() =>
                  exec(
                    `kubectl port-forward svc/temporal-frontend 7233:7233 -n temporal`
                  )
                )
              )
            ),
            Match.exhaustive
          ),
      })
    )
  )

const updateIn = (ks: string[], f: any, o: any) =>
  R.assocPath(ks, f(R.path(ks, o)), o)

type ReloadPipelineArgs = {
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
  reloadDockerImageIdent: string
  // for the user agent to connect, defaults to mqtt://localhost:1883
  mqttBrokerURL?: string
  // for the container agent to connect, defaults to  mqtt://broker.mqtt.svc.cluster.local
  containerMQTTBrokerURL?: string
}
const parseConfig = (args: ReloadPipelineArgs) => {
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

  const mqttBrokerURL = args.mqttBrokerURL || 'mqtt://localhost:1883'
  const containerMQTTBrokerURL =
    args.containerMQTTBrokerURL || 'mqtt://broker.mqtt.svc.cluster.local'

  const reloadImageIdent =
    args.reloadDockerImageIdent ||
    `us-docker.pkg.dev/diachronic/${RELOAD_IMAGE_NAME}:${RELOAD_IMAGE_TAG}`

  const buildDirectoryRoot =
    args.buildDirectoryRoot || path.join(packageRoot, 'dist')

  return {
    name,
    namespace,
    environmentName,
    monorepoRoot,
    packageRoot,
    mode,
    versionId,
    reloadImageIdent,
    // todo. build directory root, contains versioned directories
    buildDirectory: buildDirectoryRoot,
    // The output directory for the build of this version
    buildOutputDirectory: path.join(buildDirectoryRoot, versionId),
    mqttBrokerURL,
    containerMQTTBrokerURL,
  }
}

const getBuildStep = ({
  buildSpec,
  versionId,
  buildDirectory,
  packageRoot,
}: {
  versionId: string
  buildDirectory: string
  buildSpec: BuildSpec[]
  packageRoot: string
}) =>
  pipe(
    defaultPipelineSteps.build({
      versionId,
      buildDirectory,
      spec: buildSpec.map((x) => {
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

// Build workflows and/or activities
const build = ({
  buildSpec,
  versionId,
  buildDirectory,
  packageRoot,
  environmentName,
}: {
  versionId: string
  buildDirectory: string
  buildSpec: BuildSpec[]
  packageRoot: string
  environmentName: Environment
}) =>
  pipe(
    pipe(
      getBuildStep({ buildSpec, versionId, buildDirectory, packageRoot }),
      // Fail on one or more errors
      Effect.flatMap((results) => {
        const errors = results.filter((x) => x._tag === 'Right')
        const successes = results.filter((x) => x._tag === 'Left')
        if (errors.length) {
          return pipe(
            Effect.logError('🛑 Build failed'),
            Effect.tap(() =>
              // @ts-expect-error
              Effect.forEach(errors, (x) => Effect.logError(x.right))
            ),
            Effect.flatMap(() => Effect.fail({ errors, successes }))
          )
        }
        return Effect.succeed({ errors, successes })
      }),
      Effect.withLogSpan('build-workflows-and-activities')
    )
  )

const uploadDirectoryToGCS = (args: {
  bucket: string
  path: string
  versionId: string
  name: string
}) => {
  const key = `${args.name}_${args.versionId}_temporal-bundle.tar.gz`
  return pipe(
    tar(args.path, key),
    Effect.flatMap(() =>
      Effect.flatMap(GCS, (gcs) =>
        Effect.tryPromise(
          async () =>
            await finished(
              fs
                .createReadStream(key)
                .pipe(gcs.bucket(args.bucket).file(key).createWriteStream())
            )
        )
      )
    ),
    Effect.map(() => ({ bucket: args.bucket, key: key }))
  )
}

// Zips and uploads the build folder and returns a url from which the container agent may access it
export const upload = (args: {
  name: string
  buildDirectory: string
  versionId: string
}) =>
  pipe(
    uploadDirectoryToGCS({
      bucket: BUCKET_NAME,
      path: args.buildDirectory,
      versionId: args.versionId,
      name: args.name,
    }),
    Effect.flatMap(({ bucket, key }) =>
      getPresignedUrl(bucket, key, Duration.toMillis(Duration.days(1)))
    ),
    Effect.map((url) => ({ url: url[0] }))
  )

/**
 * Returns a function that deploys a Temporal worker
 * Workers run in a prebuilt Docker image that downloads workflow code uploaded by this script
 * Creates a connection with the worker container over MQTT to send reload signals
 * Uploads artifacts to Google Cloud Storage and sends short-lived signed URLs to the worker for it to download
 * @param args
 */
export const createReloadableWorkerPipeline = (args: ReloadPipelineArgs) => {
  const config = parseConfig(args)

  prettyLog({
    span: 'configuration',
    message: 'Using configuration',
    data: JSON.stringify(config, null, 2),
  })

  const {
    name,
    namespace,
    environmentName,
    monorepoRoot,
    packageRoot,
    mode,
    versionId,
    reloadImageIdent,
    buildDirectory,
    mqttBrokerURL,
    containerMQTTBrokerURL,
    buildOutputDirectory,
  } = config

  // Address the worker can talk back to us at
  const selfAddress = `dev-${os.hostname()}-${environmentName}-${name}-${versionId}`
  const containerAddress = `container-${environmentName}-${name}-${versionId}`

  type InboundMessageType = { type: string; payload: any }
  // Set up messaging to/from container agent
  let mqttScope = Effect.runSync(Scope.make())
  const mqttLayer = pipe(
    MQTTLive({ brokerURL: mqttBrokerURL }),
    Layer.catchAll((e) => {
      if (e._tag === 'MQTTConnectionRefusedError') {
        return pipe(
          Layer.empty,
          Layer.tap(() =>
            portForward(environmentName as DiachronicCloudEnvironment, 'mqtt')
          ),
          Layer.flatMap(() => MQTTLive({ brokerURL: mqttBrokerURL }))
        )
      }
      return Layer.fail(e)
    }),
    Layer.extendScope
  )
  const inbox = Effect.runSync(Queue.sliding<InboundMessageType>(2 ** 4))
  const createReceive = (box: Queue.Queue<any>) =>
    Effect.asyncEffect<any, unknown, never, never, unknown, MQTTClient>(
      (resume) =>
        Effect.flatMap(MQTTClient, (mqtt) => {
          const handler = (topic: string, message: InboundMessageType) => {
            if (topic !== selfAddress) {
              console.warn('Unexpected topic', { topic, message })
              return
            }
            const msg = JSON.parse(message.toString())
            // TODO. do something other than print
            console.log('Received:', { topic, message: msg })
            box.unsafeOffer(msg)
          }

          mqtt.on('message', handler as any)
          mqtt.subscribe(selfAddress)
          return Effect.void
        })
    )

  const createSend =
    <API extends { type: string; payload: any }>(address: string) =>
    (msg: API, opts?: { retain: boolean }) =>
      pipe(
        Effect.flatMap(MQTTClient, (mqtt) =>
          Effect.tryPromise(() =>
            mqtt.publishAsync(address, JSON.stringify(msg), {
              retain: opts?.retain || false,
            })
          )
        ),
        Effect.provide(mqttLayer),
        Effect.forkIn(mqttScope),
        Effect.map(Fiber.join)
      )

  const send = createSend<MessageType>(containerAddress)

  let receiver: RuntimeFiber<void, unknown>

  const applyReceiver = () => {
    if (receiver) return Effect.succeed(receiver)

    return pipe(
      Effect.logDebug('Creating receiver'),
      Effect.flatMap(() => createReceive(inbox)),
      Effect.provide(mqttLayer), //.pipe(Layer.tapErrorCause(Effect.logError))),
      Effect.forkIn(mqttScope),
      Effect.map((fiber) => {
        receiver = fiber
        fiber.addObserver((exit) => {
          if (Exit.isFailure(exit)) {
            throw exit.cause
          }
        })
      }),
      Effect.catchAll(Effect.logError)
    )
  }

  // We should be able to deploy the container parallel to the build process
  // and send a reload signal once storage says we wrote the build artifacts
  // this means we can always build and run an idempotent deploy step/process
  // that checks for the existence of the container and deploys it if it doesn't exist
  //
  // Since it's our container we need to provide certain configs, namely for comms over mqtt
  // and access to storage (gcs)...though we can try first pass to
  // send a signed URL for the artifacts and not need storage permissions directly
  // every reloadable container must have a broker address and an address of its own that we can know about from here

  // todo. Build and push Docker image if it doesn't exist? would allow custom images to be built as part of this process
  const deploy = () =>
    pipe(
      Effect.Do,
      // Generate manifests for this version, plus any common resources
      Effect.bind('manifests', () =>
        pipe(
          args.getManifests({
            name,
            versionId,
            namespace,
            environment: environmentName,
            dockerImageIdent: reloadImageIdent,
          }),
          // Add reloadable config
          Effect.map((xs) => {
            const [workflowDeployments, rest] = R.partition(
              (x) =>
                x.kind === 'Deployment' &&
                x.apiVersion === 'apps/v1' &&
                !!x.metadata.labels?.['ei.tech/workflow-name'],
              xs
            )
            const updated = workflowDeployments.map((x) =>
              updateIn(
                ['spec', 'template', 'spec', 'containers'],
                (containers: any) =>
                  containers.map((x: any) => ({
                    ...x,
                    env: [
                      ...(x.env || []),
                      {
                        name: 'EI_CI_MQTT_BROKER_URL',
                        value: containerMQTTBrokerURL,
                      },
                      { name: 'EI_CI_MQTT_TOPIC', value: containerAddress },
                    ],
                  })),
                x as Deployment
              )
            )
            return [...updated, ...rest] as typeof xs
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

      // TODO. this is an optimization but we only need to deploy
      // if the deployment does not exist or if the manifests changed
      // Effect.filterOrFail(
      //   ({ manifests }) => ,
      //   e=>e,
      // ),

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
      Effect.tap(({ deployments }) =>
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
    )

  const reload = (payload: Omit<Reload['payload'], 'from'>) =>
    send(
      {
        type: 'reload',
        payload: { ...payload, from: selfAddress },
      },
      { retain: false }
    )

  return () =>
    pipe(
      applyReceiver(),
      Effect.flatMap(() =>
        build({
          versionId,
          buildSpec: args.buildSpec,
          buildDirectory,
          packageRoot,
          environmentName,
        })
      ),
      Effect.bind('upload', () =>
        pipe(
          Effect.logDebug('Uploading...'),
          Effect.flatMap(() =>
            upload({
              buildDirectory: config.buildOutputDirectory,
              versionId,
              name,
            })
          ),
          Effect.withLogSpan('upload')
        )
      ),
      Effect.bind('manifests', () => deploy()),
      Effect.let('config', () => config),
      Effect.tap(({ upload }) => reload({ url: upload.url })),
      Effect.map(({ manifests }) => manifests),
      Effect.provide(makeGCSLiveLayer()),
      Effect.provide(EnvironmentLayer(environmentName)),
      Effect.provide(PrettyLogLayer('Debug')),
      Effect.provide(Layer.succeed(Scope.Scope, mqttScope)),
      Effect.runPromise
    )
}
