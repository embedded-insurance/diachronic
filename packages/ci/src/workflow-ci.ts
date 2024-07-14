import { Context, Effect, Exit, Layer, pipe, Ref, Runtime, Unify } from 'effect'
import * as R from 'ramda'
import * as wf from '@temporalio/workflow'
import { WorkflowDeployEventPayload } from './types'
import { mapGroupToScheduleActivities } from '@diachronic/workflow/activities'
import { workflowDefinitions } from './activities/definitions'
import { DbFx } from './lib/dbfx'
import {
  EffectWorkflowHandle,
  makeChildWorkflows2,
} from '@diachronic/workflow/child'
import { workflowTaskQueueName } from './workflow-migration'
import { ApplicationFailure, ParentClosePolicy } from '@temporalio/workflow'
import { WorkflowExecutionAlreadyStartedError } from '@effect-use/temporal-client'
import * as S from '@effect/schema/Schema'
import { TemporalLogLayer } from '@diachronic/workflow/workflow-logging'
import EventEmitter from 'eventemitter3'
import { WorkflowVersionInfo } from '@diachronic/toolbox/infra/versioning-types'
import { WorkflowDef } from '@diachronic/workflow/workflow'
import { Self } from './lib/self'

type Signaling<SignalMap extends Record<string, S.Schema<any>>> = {
  emitter: EventEmitter
  emit: <SignalName extends keyof SignalMap & string>(
    evt: SignalName,
    payload: S.Schema.Type<SignalMap[SignalName]>['payload']
  ) => Effect.Effect<void>
  handle: <SignalName extends keyof SignalMap & string>(
    evt: SignalName,
    fn: (
      e: S.Schema.Type<SignalMap[SignalName]>['payload']
    ) => Effect.Effect<any, any, any>
  ) => void
  route: <
    Signal extends {
      [K in keyof SignalMap]: S.Schema.Type<SignalMap[K]>
    }[keyof SignalMap]
  >(
    signal: Signal
  ) => Effect.Effect<void, any, any>
}

// const SelfRuntime = Context.Tag<Runtime.Runtime<any>>('self-runtime')

class NoRouteError extends S.TaggedError<NoRouteError>()('NoRoute', {
  message: S.String,
  input: S.Struct({
    type: S.String,
    payload: S.Unknown,
  }),
}) {}

const makeSignalRouter = <
  SignalMap extends Record<string, S.Schema<any>>,
  SignalingTag extends Context.Tag<Signaling<SignalMap>, Signaling<SignalMap>>
>(
  signalMap: SignalMap,
  runtime: Runtime.Runtime<any>,
  tag: SignalingTag
) => {
  const emitter = new EventEmitter()

  const emit = <SignalName extends keyof SignalMap & string>(
    evt: SignalName,
    payload: S.Schema.Type<SignalMap[SignalName]>['payload']
  ) =>
    pipe(
      Effect.logDebug('Emitting signal'),
      Effect.tap(() => Effect.sync(() => emitter.emit(evt, payload))),
      Effect.withLogSpan('signal.emit')
    )

  const handle = <SignalName extends keyof SignalMap & string>(
    evt: SignalName,
    fn: (
      e: S.Schema.Type<SignalMap[SignalName]>['payload']
    ) => Effect.Effect<any, any, any>
  ): void =>
    void emitter.on(evt, (x) =>
      pipe(
        fn(x),
        Effect.withLogSpan('signal-handler/' + evt),
        Effect.provide(
          Layer.succeed(
            tag,
            // @ts-expect-error
            { emit, handle, route, emitter }
          )
        ),
        Runtime.runPromiseExit(runtime)
      )
    )

  const route = <
    Signal extends {
      [K in keyof SignalMap]: S.Schema.Type<SignalMap[K]>
    }[keyof SignalMap]
  >(
    signal: Signal
  ) =>
    pipe(
      Effect.succeed(signal),
      Effect.annotateLogs({
        type: signal?.type,
        payload: signal?.payload,
      }),
      Effect.flatMap((x) => {
        if (!signalMap[x.type]) {
          return Effect.fail(
            new NoRouteError({
              message: `No route for signal ${x.type}`,
              input: x,
            })
          )
        }
        if (!emitter.listeners(x.type).length) {
          return Effect.fail(
            new NoRouteError({
              message: `No listeners registered for ${x.type}`,
              input: x,
            })
          )
        }
        return pipe(
          Effect.sync(() => emitter.emit(x.type, x.payload)),
          Effect.tap(() => Effect.logDebug('Signal routed')),
          Runtime.runFork(runtime),
          Effect.succeed
        )
      }),
      Effect.withLogSpan('diachronic.workflow.events/router')
    )

  return {
    emitter,
    emit,
    handle,
    route,
  }
}

export const Signaling = Context.GenericTag<Signaling<SignalMap>>(
  'diachronic.workflow-ci.signaling'
)

const Signals = workflowDefinitions.workflowCI['temporal.workflow'].signals

type ChildWorkflowDefinitions<T extends WorkflowDef> =
  T['temporal.workflow']['childWorkflows']

type MigrationError = S.Schema.Type<
  ChildWorkflowDefinitions<
    typeof workflowDefinitions.workflowCI
  >['migration']['error']
>
type MigrationSuccess = S.Schema.Type<
  ChildWorkflowDefinitions<
    typeof workflowDefinitions.workflowCI
  >['migration']['output']
>

const InternalSignals = {
  'migration.done': S.Any as S.Schema<{
    type: 'migration.done'
    payload: Exit.Exit<MigrationSuccess, MigrationError>
  }>,
  'rollout.done': S.Any as S.Schema<{
    type: 'rollout.done'
    payload: Exit.Exit<any, any>
  }>,
}
type InternalSignals = S.Schema.Type<
  (typeof InternalSignals)[keyof typeof InternalSignals]
>
type SignalMap = typeof InternalSignals & typeof Signals

type Signals = S.Schema.Type<(typeof Signals)[keyof typeof Signals]> &
  InternalSignals

type Db = {
  config: WorkflowDeployEventPayload
  toVersion: WorkflowVersionInfo
  fromVersion: WorkflowVersionInfo
  // todo. does the api return archived ones for these? to what extent do we need them
  priorVersions: WorkflowVersionInfo[]
  simulations: any
  workflows: {
    rollout?: {
      exit?: Exit.Exit<any, any>
      handle?: EffectWorkflowHandle<(typeof workflowDefinitions)['rollout']>
    }
    migration?: {
      exit?: Exit.Exit<any, any>
      handle?: EffectWorkflowHandle<(typeof workflowDefinitions)['migration']>
    }
  }
  events: any[]
}
const activities = mapGroupToScheduleActivities(
  workflowDefinitions.workflowCI['temporal.workflow'].activities
)
const workflows = makeChildWorkflows2(
  workflowDefinitions.workflowCI['temporal.workflow'].childWorkflows
)

type Ctx = {
  db: DbFx<Db>
  fx: typeof activities & typeof workflows
  self: Self<Db, SignalMap>
}
export const Ctx = Context.GenericTag<Ctx>('@services/Ctx')

const getFromVersion = (
  versionId: string,
  allWorkflowFlags: readonly WorkflowVersionInfo[]
) => {
  const fst = R.head(allWorkflowFlags)
  if (!fst) {
    return undefined
  }
  if (fst.versionId === versionId) {
    return R.nth(1, allWorkflowFlags)
  }
  return fst
}

export const onWorkflowDeploymentSuccess = ({
  versionId,
  workflowName,
  environment,
  isNonMigratory,
  isDarkDeploy,
  sha,
  eventTime,
}: WorkflowDeployEventPayload) =>
  Effect.flatMap(Ctx, ({ db, fx }) =>
    pipe(
      Effect.Do,
      Effect.bind('allWorkflowFlags', () =>
        pipe(
          fx.getAllWorkflowVersionFlags({ workflowName }),
          Effect.tap((a) =>
            // @ts-expect-error
            db.assoc('allWorkflowFlags', a)
          )
        )
      ),
      Effect.tap(() =>
        db.assoc('config', {
          workflowName,
          versionId,
          environment,
          isNonMigratory,
          isDarkDeploy,
          sha,
          eventTime,
        })
      ),
      Effect.bind('fromVersion', ({ allWorkflowFlags }) =>
        pipe(
          Effect.try(() => getFromVersion(versionId, allWorkflowFlags)),
          Effect.tap((fromVersion) => db.assoc('fromVersion', fromVersion!))
        )
      ),

      // Use existing flag for versionId if it exists
      // Create it if it doesn't
      Effect.bind('toVersion', () =>
        pipe(
          fx.applyWorkflowVersionFlag({
            workflowName,
            versionId,
          }),
          Effect.tap((result) => db.assoc('toVersion', result))
        )
      ),
      Effect.bind('previousSimulation', ({ fromVersion }) => {
        if (!fromVersion) {
          return pipe(
            Effect.log(
              'No previous version. No prior version will be simulated.'
            ),
            Effect.flatMap(() => Effect.succeed([] as any))
          )
        }
        return pipe(
          Effect.log('Starting previous version simulation'),
          Effect.flatMap(() =>
            fx.startWorkflowSimulation({
              workflowName,
              scenarioName: 'default',
              taskQueue: workflowTaskQueueName({
                workflowName,
                versionId: fromVersion.versionId,
              }),
              versionId: fromVersion.versionId,
              environment,
            })
          ),
          Effect.tap((simulation) =>
            db.swap((a) =>
              R.assocPath(
                ['previousVersion', 'simulations', simulation.scenarioName],
                simulation,
                a
              )
            )
          ),
          Effect.catchTags({
            UnsupportedSimulation: (e) =>
              pipe(
                Effect.logInfo('Simulation not supported. Continuing.'),
                Effect.tap(() =>
                  db.swap((a) =>
                    R.assocPath(
                      [
                        'previousVersion',
                        'simulations',
                        e.scenarioName || '<none>',
                      ],
                      e,
                      a
                    )
                  )
                ),
                Effect.tap(() => Effect.succeed(Effect.void))
              ),
          })
        )
      }),
      Effect.bind('currentSimulation', () =>
        pipe(
          Effect.log('Starting current version simulation'),
          Effect.flatMap(() =>
            fx.startWorkflowSimulation({
              workflowName,
              scenarioName: 'default',
              taskQueue: workflowTaskQueueName({
                workflowName,
                versionId,
              }),
              versionId,
              environment,
            })
          ),
          Effect.tap((simulation) =>
            db.swap((a) =>
              R.assocPath(
                ['simulations', simulation.scenarioName],
                simulation,
                a
              )
            )
          ),
          Effect.catchTag('UnsupportedSimulation', (e) =>
            pipe(
              Effect.logInfo('Simulation not supported. Continuing.'),
              Effect.tap(() =>
                db.swap((a) =>
                  R.assocPath(['simulations', e.scenarioName || '<none>'], e, a)
                )
              ),
              Effect.tap(() => Effect.succeed(Effect.void))
            )
          )
        )
      ),
      Effect.bind('signaling', () => Signaling),

      // Spawn rollout process if not a dark deploy, otherwise wait for the signal
      Effect.bind('rollout', ({ signaling }) =>
        Effect.if(!!isDarkDeploy, {
          onTrue: () =>
            pipe(
              Effect.logInfo(
                'Is dark deploy. Waiting for start rollout signal'
              ),
              Effect.flatMap(() => Effect.die(Effect.succeed('waiting')))
            ),
          onFalse: () =>
            signaling.route({
              type: 'diachronic.ci.workflow.rollout.start',
              payload: {
                workflowName,
                environment,
              },
            }),
        })
      )
    )
  )

const handleCleanup = (args: any) =>
  Effect.flatMap(Ctx, ({ db, fx }) =>
    pipe(
      db.deref(),
      Effect.flatMap(({ fromVersion, config: { isNonMigratory } }) =>
        Effect.if(!!fromVersion && isNonMigratory === true, {
          onTrue: () =>
            pipe(
              Effect.logInfo('Spawning cleanup workflow'),
              Effect.flatMap(() =>
                fx.cleanup.startChild(
                  { versionInfo: fromVersion },
                  {
                    temporalOptions: {
                      workflowId: `cleanup.${fromVersion.taskQueue}`,
                      parentClosePolicy:
                        ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
                    },
                  }
                )
              ),
              Effect.tap((handle) =>
                db.swap(R.assocPath(['workflows', 'cleanup', 'handle'], handle))
              )
            ),
          onFalse: () => Effect.succeed(Effect.void),
        })
      ),
      Effect.withLogSpan('handleCleanup')
    )
  )

const handleMigration = (_args: any) =>
  Effect.flatMap(Ctx, ({ db, fx }) =>
    pipe(
      db.deref(),
      Effect.flatMap(
        ({
          fromVersion,
          toVersion,
          config: { workflowName, isNonMigratory },
        }) =>
          Effect.if(!!isNonMigratory, {
            onTrue: () => Effect.succeed('Workflow is non-migratory'),
            onFalse: () =>
              Effect.if(!fromVersion, {
                onTrue: () =>
                  Effect.succeed('No previous version. Nothing to migrate.'),
                onFalse: () =>
                  pipe(
                    Effect.log('Queuing migration workflow...'),
                    Effect.flatMap(() =>
                      pipe(
                        fx.migration.startChild(
                          {
                            workflowName,
                            fromTaskQueue: fromVersion!.taskQueue,
                            toTaskQueue: toVersion.taskQueue,
                          },
                          {
                            temporalOptions: {
                              workflowId: `migration.${workflowName}`, //_from_${fromTaskQueue}_to_${toTaskQueue}`,
                              parentClosePolicy:
                                ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
                            },
                          }
                        ),
                        Effect.tap((wf) =>
                          db.swap((state) =>
                            R.assocPath(
                              ['workflows', 'migration', 'handle'],
                              wf,
                              state
                            )
                          )
                        ),
                        Effect.tap(() => Effect.logInfo('Migration started')),
                        Effect.flatMap((wf) =>
                          pipe(
                            wf.result(),
                            Effect.matchEffect({
                              onSuccess: (a) =>
                                pipe(
                                  Effect.logInfo(
                                    'Migration workflow completed successfully'
                                  ),
                                  Effect.flatMap(() =>
                                    Effect.flatMap(Signaling, (signaling) =>
                                      signaling.emit('migration.done', a as any)
                                    )
                                  )
                                ),
                              onFailure: (e) =>
                                pipe(
                                  Effect.logInfo('Migration workflow failed'),
                                  Effect.flatMap(() =>
                                    Effect.flatMap(Signaling, (signaling) =>
                                      signaling.emit('migration.done', e as any)
                                    )
                                  )
                                ),
                            }),
                            Effect.withLogSpan('migration-process')
                          )
                        ),
                        Effect.catchAllCause((e) => {
                          if (S.is(WorkflowExecutionAlreadyStartedError)(e)) {
                            return pipe(
                              Effect.logWarning('Migration already running', e),
                              Effect.annotateLogs({
                                workflowName,
                                fromVersion,
                                toVersion,
                              }),
                              Effect.flatMap(() => Effect.succeed(e))
                            )
                          }
                          return Effect.fail(e)
                        }),
                        Effect.withLogSpan('start-migration')
                      )
                    )
                  ),
              }),
          })
      ),
      Effect.withLogSpan('handleMigration')
    )
  )

const handleRollout = ({ workflowName }: { workflowName: string }) =>
  // this is awkward but we start migration here since we expect to receive an external signal
  Effect.flatMap(Ctx, ({ db, fx }) =>
    pipe(
      db.deref(),
      Effect.flatMap(({ fromVersion, toVersion }) =>
        Effect.if(!fromVersion, {
          onTrue: () =>
            fx.applyWorkflowTrafficRouting({
              percent: '100',
              workflowFlagName: toVersion.flagName,
            }),
          onFalse: () =>
            pipe(
              Effect.logInfo('Queuing rollout workflow...'),
              Effect.flatMap(() =>
                fx.rollout.startChild(
                  {
                    workflowName,
                    toVersion,
                  },
                  {
                    temporalOptions: {
                      workflowId: `rollout.${workflowName}`,
                      parentClosePolicy:
                        ParentClosePolicy.PARENT_CLOSE_POLICY_TERMINATE,
                    },
                  }
                )
              ),
              Effect.tap((wf) =>
                db.swap((state) =>
                  R.assocPath(['workflows', 'rollout', 'handle'], wf, state)
                )
              ),
              Effect.tap(() => Effect.logInfo('Rollout started')),
              Effect.tap(() =>
                pipe(
                  db.deref(),
                  Effect.flatMap((state) => {
                    if (
                      // state.config.isDarkDeploy &&
                      !state.config.isNonMigratory
                    ) {
                      return pipe(
                        Effect.logInfo(
                          'Workflow is migratory. Starting migration process'
                        ),
                        Effect.flatMap(() =>
                          Effect.flatMap(Signaling, (signaling) =>
                            signaling.route({
                              type: 'diachronic.ci.workflow.migration.start',
                              payload: {
                                workflowName: state.config.workflowName,
                                environment: state.config.environment,
                              },
                            })
                          )
                        )
                      )
                    }
                    return pipe(
                      Effect.logInfo(
                        'Workflow is non-migratory. Skipping migration process'
                      ),
                      Effect.tap(() => Effect.void)
                    )
                  })
                )
              ),
              Effect.flatMap((wf) =>
                pipe(
                  wf.result(),
                  Effect.matchEffect({
                    onSuccess: (a) =>
                      pipe(
                        Effect.logInfo(
                          'Rollout workflow completed successfully'
                        ),
                        Effect.flatMap(() =>
                          Effect.flatMap(Signaling, (signaling) =>
                            signaling.emit('rollout.done', a as any)
                          )
                        )
                      ),
                    onFailure: (e) =>
                      pipe(
                        Effect.logInfo('Rollout workflow failed'),
                        Effect.flatMap(() =>
                          Effect.flatMap(Signaling, (signaling) =>
                            signaling.emit('rollout.done', e as any)
                          )
                        )
                      ),
                  }),
                  Effect.withLogSpan('rollout-process')
                  // Effect.fork,
                  // Effect.flatMap((x) => x.await)
                )
              )
            ),
        })
      )
    )
  )

// this is horrible and will be cleaned up
export const registerSignalHandlers = (runtime: Runtime.Runtime<Ctx>) => {
  const signaling = makeSignalRouter(
    { ...Signals, ...InternalSignals },
    runtime,
    Signaling
  )
  signaling.handle('diachronic.ci.workflow.migration.start', handleMigration)

  signaling.handle('diachronic.ci.workflow.rollout.start', handleRollout)

  signaling.handle('diachronic.ci.workflow.rollout.cancel', (args) =>
    Effect.flatMap(Ctx, ({ db }) =>
      pipe(
        db.get('workflows'),
        Effect.flatMap((workflows) => {
          if (workflows.rollout?.handle) {
            return pipe(
              Effect.logInfo('Sending cancellation signal to rollout workflow'),
              Effect.annotateLogs({
                workflowName: args.workflowName,
                workflowId: workflows.rollout.handle.workflowId,
                runId: workflows.rollout.handle.firstExecutionRunId,
              }),
              Effect.flatMap(() => workflows.rollout!.handle!.cancel())
            )
          }
          return pipe(
            Effect.logInfo(`No rollout workflow found. Can't cancel.`),
            Effect.flatMap(() => Effect.succeed(Effect.void))
          )
        })
      )
    )
  )
  signaling.handle(
    'diachronic.ci.workflow.deploy.success',
    onWorkflowDeploymentSuccess
  )

  signaling.handle('rollout.done', (args) =>
    Effect.flatMap(Ctx, ({ db, self }) =>
      pipe(
        db.swap(R.assocPath(['workflows', 'rollout', 'exit'], args)),
        Effect.flatMap(() => db.deref()),
        Effect.flatMap(
          Unify.unify((state) => {
            if (state.config.isNonMigratory && state.workflows.rollout?.exit) {
              if (state.workflows.rollout?.exit) {
                return pipe(
                  Effect.logInfo(
                    'Rollout finished and workflow is non-migratory. Closing workflow.'
                  ),
                  Effect.flatMap(() => handleCleanup(undefined)),
                  Effect.flatMap(() => self.close(args))
                )
              }
            }
            if (
              state.workflows.rollout?.exit &&
              state.workflows.migration?.exit
            ) {
              return pipe(
                Effect.logInfo(
                  'Migration and rollout finished. Closing workflow.'
                ),
                Effect.flatMap(() => self.close(args))
              )
            }
            return pipe(
              Effect.logInfo(`Rollout done, migration still running.`),
              Effect.flatMap(() => Effect.succeed(Effect.void))
            )
          })
        )
      )
    )
  )
  signaling.handle('migration.done', (args) =>
    Effect.flatMap(Ctx, ({ db, self }) =>
      pipe(
        db.swap((v) =>
          R.assocPath(['workflows', 'migration', 'exit'], args, v)
        ),
        Effect.flatMap(() => db.get('workflows')),
        Effect.flatMap(
          Unify.unify((workflows) => {
            if (workflows.rollout?.exit) {
              return pipe(
                Effect.logInfo(
                  'Migration and rollout finished. Closing workflow.'
                ),
                Effect.flatMap(() => self.close(args))
              )
            }
            return pipe(
              Effect.logInfo(
                `Migration finished but rollout workflow still pending.`
              ),
              Effect.flatMap(() => Effect.succeed(Effect.void))
            )
          })
        )
      )
    )
  )
  return { signaling }
}

export const workflowCI = async () => {
  const blocker = new wf.Trigger()

  const db = Ref.unsafeMake({} as any)
  const dbFx = DbFx(db)
  const self = Self.make(blocker)

  const runtime = pipe(
    Layer.succeed(Ctx, {
      self,
      db: dbFx,
      fx: { ...activities, ...workflows },
    }),
    Layer.provideMerge(TemporalLogLayer('Trace')),
    Layer.toRuntime,
    Effect.scoped,
    Effect.runSync
  )
  const { signaling } = registerSignalHandlers(runtime)

  wf.setHandler(wf.defineQuery('db'), () => Effect.runSync(dbFx.deref()))

  wf.setDefaultSignalHandler(async (type, payload) => {
    const signal = { type, payload } as Signals

    if (wf.workflowInfo().continueAsNewSuggested) {
      console.log('Continue as new suggested. Continuing as new.')
      return await wf.continueAsNew({
        state: Effect.runSync(dbFx.deref()),
      })
    }

    return await pipe(
      signaling.route(signal),
      Effect.provide(TemporalLogLayer('Trace')),
      Effect.catchTags({
        NoRoute: (e) =>
          pipe(
            Effect.logInfo('Ignoring no route for event'),
            Effect.tap(() => Effect.ignoreLogged(e))
          ),
      }),
      Runtime.runPromiseExit(runtime)
    )
      .then((x) =>
        Exit.isFailure(x)
          ? blocker.reject(
              ApplicationFailure.create({
                type: 'Exit',
                message: 'Fail',
                cause: new Error(x.cause.toString()),
                details: [x],
                nonRetryable: true,
              })
            )
          : void 0
      )
      .catch((x) =>
        Exit.isFailure(x)
          ? blocker.reject(
              ApplicationFailure.create({
                type: 'Exit',
                message: 'Fail',
                cause: new Error(x.cause.toString()),
                details: [x],
                nonRetryable: true,
              })
            )
          : blocker.reject(x)
      )
  })

  return blocker
}
