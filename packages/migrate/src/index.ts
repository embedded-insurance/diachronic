// import './workflow-runtime'
import {
  defineQuery,
  defineSignal,
  makeContinueAsNewFunc,
  setHandler,
  Trigger,
  setDefaultSignalHandler,
} from '@temporalio/workflow'
import * as S from '@effect/schema/Schema'
import {
  CustomInterpreter,
  interpret,
  restoreTimersOnStart,
  startTimersOnStart,
  TimerData,
  TimerDataEntry,
} from './interpreter'
import {
  Actor,
  AnyState,
  AnyStateMachine,
  StateMachine,
  StateValue,
  Subscription,
} from 'xstate'
import { isPlainObject } from '@diachronic/util/isPlainObject'
import { CustomClock } from './clock'
import { isXStateAfterId, XStateStateValue } from './analysis'
import * as Effect from 'effect/Effect'
import { canMigrate } from './can-migrate'
import { pipe } from 'effect/Function'
import { dissoc } from 'ramda'

/**
 * Forwards Temporal signals to an XState `interpreter`
 * Signals are named by the keys of `eventMap`
 * @param eventMap
 * @param interpreter
 */
export const forwardSignalsToXState = <
  EventNameToEventDecoderMap extends Record<string, S.Schema<never, any, any>>
>(
  eventMap: EventNameToEventDecoderMap,
  interpreter: Actor<any, any>
) => {
  Object.entries(eventMap).forEach(([eventName, decoder]) => {
    const signal =
      defineSignal<
        S.Schema.To<
          EventNameToEventDecoderMap[keyof EventNameToEventDecoderMap]
        >
      >(eventName)
    setHandler(signal, (payload) => {
      pipe(
        S.decode(decoder)(
          {
            type: eventName,
            meta: payload
              ? payload['diachronic.workflow.request.meta']
              : undefined,
            payload: payload
              ? dissoc('diachronic.workflow.request.meta', payload)
              : payload,
          },
          { errors: 'all' }
        ),
        Effect.tap((event) =>
          pipe(
            Effect.logDebug('Forwarding event to state machine'),
            Effect.annotateLogs({ event })
          )
        ),
        Effect.map((event) => interpreter.send(event)),
        Effect.tapErrorCause((e) =>
          Effect.logError('Error forwarding event to state machine', e)
        ),
        Effect.withLogSpan('forwardSignalsToXState'),
        Effect.either,
        Effect.runSync
      )
    })
  })
}

/**
 * Signal sent to a workflow that will cause it to migrate to a new version via ContinueAsNew
 * @param taskQueue
 */
export type MigrateSignalPayload = { taskQueue: string }
export const migrateSignal = defineSignal<[MigrateSignalPayload]>(
  'diachronic.v1.migrate'
)

/**
 * For development/debugging only
 * Signal sent to a workflow that will cause it to continue as new with
 * the values provided in the signal payload on the provided taskQueue
 * If no taskQueue is provided, the workflow will continue on the same taskQueue
 */
export const resetSignalName = 'diachronic.v1.reset'
export type ResetSignalPayload = WorkflowSnapshot & {
  taskQueue?: string
}

export const resetSignal = defineSignal<[ResetSignalPayload]>(resetSignalName)

export type WorkflowSnapshot = {
  state: StateValue | null
  context: unknown
  timers: TimerData
  migrate: {
    awaitingContinuationCondition: boolean
  }
}

/**
 * Query that returns a snapshot of the workflow's state
 */
export const getSnapshotQueryName = 'diachronic.v1.snapshot'
export const getSnapshot = defineQuery<WorkflowSnapshot>(getSnapshotQueryName)

/**
 * Resolves the state value and sets the initial context of the machine
 * Returns an error when the state value cannot be resolved
 * @param state
 * @param context
 * @param machine
 */
const getContinuationXStateNode = (
  state: StateValue,
  context: any,
  machine: AnyStateMachine
): AnyState | Error => {
  try {
    return machine.resolveStateValue(state, context)
  } catch (e) {
    console.error('Could not resolve continuation state', e)
    return e as Error
  }
}
/**
 * Arguments passed to a workflow that is continuing from a previous run
 */
const Continuation = S.struct({
  state: XStateStateValue,
  context: S.unknown,
  timers: S.unknown,
})
type Continuation = {
  state: StateValue
  context: unknown
  timers: TimerData
}

/**
 * Key used to pass continuation data to a workflow
 */
const continuationKey = 'waas.continuation' as const
type ContinuationKey = typeof continuationKey

/**
 * Returns true if the workflow's arguments are a continuation
 * @param x
 */
const isContinuationWorkflowArguments = (
  x: any
): x is { [K in ContinuationKey]: unknown } =>
  isPlainObject(x) && continuationKey in x

/**
 * Returns true if a valid continuation data shape
 * @param x
 */
const isValidContinuation = (x: unknown): x is Continuation =>
  S.is(Continuation)(x)

type WorkflowDefinition = {
  context: S.Schema<never, any, any>
  state: S.Schema<never, any, any>
  signals: Record<string, S.Schema<never, any, any>>
  timers: Record<string, S.Schema<never, any, any>>
}

/**
 * Type safe migration function
 *
 * Requires machine definition and StateIds for previous and next machines
 *
 * Timers must be defined via the machine's "types" property:
 *
 * ```ts
 * const machine = createMachine({
 *   types: {} as {delays: "timer-1" | "timer-2" | "timer-3 }},
 *   ...
 * })
 * ```
 */
export type MigrationFnV1<
  Prev extends MetaMachine<any, any>,
  Next extends MetaMachine<any, any>
> = (args: {
  state: Prev['migrationStates']
  context: Prev['context']
  timers: Prev['delays']
}) => Effect.Effect<
  never,
  never,
  {
    state: Next['migrationStates'] // extends MetaMachine<any, infer States> ? States : never
    context: Next['context']
    timers: Next['delays']
  }
>
/**
 * Defines a machine that can be migrated from or to
 * Requires MigrationStateIds which can be generated from
 */
export type MetaMachine<Machine extends AnyStateMachine, MigrationStateIds> = {
  machine: Machine
  context: Machine extends StateMachine<
    infer Context,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any
  >
    ? Context
    : never
  delays: Machine extends StateMachine<
    any,
    any,
    any,
    any,
    any,
    infer Delays, // extends string ,
    any,
    any,
    any,
    any
  >
    ? // it seems like we can't tell if all string literals at this point
      // somehow we can later..? not understanding how.
      // The type here is expanded to the union of both failures when
      // all machine delay types appear to be string literals
      // i.e blah is not assignable to "first" | "no"...
      // this rejects a seemingly valid generic to makeWorkflow<A <-- here
      // ? (string extends Delays
      //   ? 'first'
      //   : Delays)
      // : 'no'
      // this means we enforce string literal-only timer definitions but don't require them
      // (should work with a generic Record<string, any> if that's what the user defines
      { [K in Delays]?: TimerDataEntry }
    : never
  migrationStates: MigrationStateIds
}

/**
 * Key in xstate context with the last db snapshot value
 */
export const dbSnapshotKey = 'diachronic.v1.db-snapshot' as const
export type DbSnapshotKey = typeof dbSnapshotKey

/**
 * Functions to automate saving to the database
 */
export type DbFns<DbSnapshot, WorkflowContext> = {
  /**
   * If true, write it to the database
   * @param a
   * @param b
   */
  isDbSnapshotEqual: (a: DbSnapshot, b: DbSnapshot) => boolean
  /**
   * A function that computes a value that will be automatically saved in the background via SaveDbSnapshot
   */
  getDbSnapshot: (a: WorkflowContext) => DbSnapshot
  /**
   * A function that is called when the value produced by GetDbSnapshot is different from its previous value
   */
  onNewDbSnapshot: (dbSnapshotValue: DbSnapshot) => Promise<any>
}
const defaultLogImpl = {
  debug: () => {},
  info: () => {},
  error: () => {},
}

/**
 * Defines a workflow that can continue
 * @param name
 * @param machine
 * @param signals
 * @param receive
 * @param db
 * @param log
 */
export const makeWorkflow = <
  Prev extends MetaMachine<any, any> | never,
  Next extends MetaMachine<any, any>
>({
  name,
  machine,
  signals,
  receive,
  db,
  logger,
}: {
  name: string
  machine: Next['machine']
  signals: Record<string, S.Schema<never, any, any>>
  receive?: Prev extends any ? MigrationFnV1<Prev, Next> : never
  db?: DbFns<any, Next['context']>
  logger?: {
    debug: (msg: string, args?: Record<string, any>, span?: string) => void
    info: (msg: string, args?: Record<string, any>, span?: string) => void
    error: (msg: string, args?: Record<string, any>, span?: string) => void
  }
}) => {
  const log = logger || defaultLogImpl
  const workflow = async (args?: { [K in ContinuationKey]?: Continuation }) => {
    const blocker = new Trigger()

    try {
      let currentContext: unknown = null
      let currentState: StateValue | null = null
      let currentStateObject: AnyState | null = null
      let interpreter: CustomInterpreter<AnyStateMachine>
      let awaitingContinuationCondition = false

      if (isContinuationWorkflowArguments(args)) {
        log.info('Received continuation key', args)
        const continuationWorkflowArguments = args[continuationKey]
        if (!isValidContinuation(continuationWorkflowArguments)) {
          log.error(
            'Invalid continuation data received from previous workflow',
            { continuationWorkflowArguments }
          )
          throw new Error(
            'Invalid continuation data received from previous workflow'
          )
        }

        let continuationData: Continuation
        if (receive) {
          log.debug('Received migration function. Running it')
          const next = await Effect.runPromise(
            receive({
              state: continuationWorkflowArguments.state,
              // @ts-expect-error - todo
              context: continuationWorkflowArguments.context,
              timers: continuationWorkflowArguments.timers,
            })
          )
          log.info('Migration function returned:', next)
          if (db && next.context) {
            log.debug('Diffing db snapshot')
            const nextDb = db.getDbSnapshot(next.context)
            const prevDb = next.context[dbSnapshotKey]
            if (!db.isDbSnapshotEqual(nextDb, prevDb)) {
              log.info('Saving new db value', nextDb)
              void db
                .onNewDbSnapshot(nextDb)
                .then((e) => {
                  // @ts-ignore
                  next.context[dbSnapshotKey] = nextDb
                })
                .catch((e) => {
                  log.error('Error saving to db', e)
                })
            } else {
              log.debug('Db value unchanged, skipping persist on resume')
            }
          }
          // @ts-expect-error todo
          continuationData = next
        } else {
          log.info(
            'No migration function provided. Using continuation data from previous workflow run'
          )
          continuationData = continuationWorkflowArguments
        }

        const continuationState = getContinuationXStateNode(
          continuationData.state,
          continuationData.context,
          machine
        )

        if (continuationState instanceof Error) {
          log.error('Could not resolve continuation state', continuationState)
          throw continuationState
        }

        log.info('Continuing from previous state', {
          state: continuationState.value,
          context: continuationState.context,
        })

        interpreter = interpret(machine, {
          state: continuationState,
          clock: new CustomClock(),
        })
        const initialState = interpreter.getPersistedState()

        if (!initialState) {
          throw new Error('Could not get persisted state')
        }

        const delayEventsInState = continuationState.nextEvents.filter((x) =>
          isXStateAfterId(x)
        )

        // Those timers that are restored are subject to recomputation of their delay
        // as a function of the time they started and the new delay
        //
        // Only newly added timers in the start state occur in this set
        // XState does not start them by default so we start them manually
        // as this is more expected behavior for us
        //
        // As with restored timers, the delay events are sent upon reaching the start state
        const delayEventsInStateNotRestored = delayEventsInState.filter(
          (delayEvent) => !continuationData.timers[delayEvent]
        )

        if (delayEventsInStateNotRestored.length) {
          log.info(
            'Detected timers that were not transferred as part of the migration function'
          )
          startTimersOnStart(
            interpreter,
            machine,
            continuationState,
            delayEventsInStateNotRestored
          )
        } else {
          log.info(
            'Either the start state has no timers or all were provided as part of the continuation.'
          )
        }

        if (
          continuationData.timers &&
          Object.keys(continuationData.timers).length
        ) {
          log.debug(
            'Setting up timer restoration for ',
            continuationData.timers
          )
          restoreTimersOnStart(
            interpreter,
            continuationData.timers,
            initialState.value,
            machine
          )
        } else {
          log.debug('Migration function provided no timers to restore')
        }

        currentState = initialState.value
        currentContext = initialState.context
      } else {
        // todo. add clock to arguments?
        interpreter = interpret(machine, { clock: new CustomClock() })
        const initialState = interpreter.getPersistedState()
        if (!initialState) {
          throw new Error('Could not get persisted state')
        }
        currentState = initialState.value
        currentContext = initialState.context
      }

      // Set up a listener that resolves the blocker when the machine reaches a terminal state
      interpreter.subscribe((event) => {
        if (event.done) {
          log.info('Machine reached a terminal state...')
          // blocker.resolve(event.value)
        }
      })

      // Save current state, context transitions
      interpreter.subscribe(
        (state) => {
          log.info('State transitioned to:', { stateValue: state.value })
          currentStateObject = state
          currentContext = state.context
          currentState = state.value
          log.debug('ctx is', { currentContext })
        },
        (e) => {
          log.error('xstate error', e)
        },
        () => {
          log.info('xstate machine shut down. resolving blocker')
          // TODO. ensure we want migrate here instead of end by default
          // add configuration option: migrateWhenMachineDone
          if (!awaitingContinuationCondition) {
            blocker.resolve({ context: currentContext, state: currentState })
          }
        }
      )

      // Finally start the machine
      log.info('Starting machine...')
      interpreter.start()

      log.debug('Registering query handlers')
      setHandler(getSnapshot, (): WorkflowSnapshot => {
        log.info(
          `Responding to query: ${getSnapshotQueryName}`
          //   {
          //   state: currentState,
          //   context: currentContext,
          //   timers: interpreter.getTimers(),
          //   'Date.now': Date.now(),
          //   // taskQueue: workflowInfo().taskQueue,
          // }
        )
        return {
          state: currentState,
          context: currentContext,
          timers: interpreter.getTimers(),
          migrate: { awaitingContinuationCondition },
          // @ts-ignore
          'Date.now': Date.now(),
        }
      })

      let okToMigrateSubscription: Subscription | null = null
      const sleep = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms))

      // Handle migration signal
      const handleMigrate = async (args: MigrateSignalPayload) => {
        log.info('Migrate signal received', args)
        const data = args
        log.info('about to wait')
        // defer executing the body of this function until other async operations are complete
        // this includes receiving signals
        // it's ok to do this for every time the function is called (in event of duplicate migration signals)
        await sleep(0)
        log.info('waited')

        // remove the old one in case this is called more than once
        if (okToMigrateSubscription) {
          okToMigrateSubscription.unsubscribe()
        }

        if (!(currentStateObject && canMigrate(currentStateObject))) {
          awaitingContinuationCondition = true
          log.info(
            `State ${JSON.stringify(
              currentStateObject?.value
            )} is not ok to migrate. Waiting until a state that is ok...`
          )

          okToMigrateSubscription = interpreter.subscribe((state) => {
            log.debug('Checking if can migrate for ', {
              stateValue: state.value,
            })

            const ok = canMigrate(state)
            log.debug(`canMigrate returned ${ok}`)

            if (!ok) return

            okToMigrateSubscription?.unsubscribe()
            const continueAsNew = makeContinueAsNewFunc({
              taskQueue: data.taskQueue,
            })

            log.info('Starting continue as new...')

            continueAsNew({
              [continuationKey]: {
                state: currentState,
                context: currentContext,
                timers: interpreter.data.timers,
              },
            }).catch(blocker.reject)
          })

          // exit here, wait for state machine subscription to fire
          return
        }
        log.info(
          `State ${JSON.stringify(currentStateObject?.value)} is ok to migrate.`
        )

        const continueAsNew = makeContinueAsNewFunc({
          taskQueue: data.taskQueue,
        })

        log.info('Starting continue as new...')
        continueAsNew({
          [continuationKey]: {
            state: currentState,
            context: currentContext,
            timers: interpreter.data.timers,
          },
        }).catch(blocker.reject)
      }

      // Handle reset signal
      const handleReset = async (args: ResetSignalPayload) => {
        // @ts-expect-error
        const data = args[0] || (args as ResetSignalPayload)
        log.info('Signal received: diachronic.v1.reset', data)

        const continueAsNew = makeContinueAsNewFunc(
          data.taskQueue ? { taskQueue: data.taskQueue } : undefined
        )
        log.info('Starting continue as new...')
        await continueAsNew({
          [continuationKey]: {
            state: data.state,
            context: data.context,
            timers: data.timers,
          },
        })
      }

      log.debug('Registering signal handlers')

      const signalHandler = (signalName: any, args: any) => {
        log.info('Received signal', { signalName, args })
        switch (signalName) {
          case migrateSignal.name:
            return handleMigrate(args as MigrateSignalPayload)

          case resetSignalName:
            return handleReset(args as ResetSignalPayload)

          default: {
            const decoder = signals[signalName]
            if (!decoder) {
              log.error('No decoder for signal', { signalName, args })
              interpreter.send({ type: signalName, payload: args })
              return
            }
            pipe(
              S.decode(decoder)(
                {
                  type: signalName,
                  meta: args
                    ? args['diachronic.workflow.request.meta']
                    : undefined,
                  payload: args
                    ? dissoc('diachronic.workflow.request.meta', args)
                    : args,
                },
                { errors: 'all' }
              ),
              Effect.tapErrorCause(Effect.logError),
              Effect.tap((evt) =>
                pipe(
                  Effect.logTrace('sending signal to xstate interpreter'),
                  Effect.annotateLogs(evt)
                )
              ),
              Effect.map((event) => interpreter.send(event)),
              Effect.either,
              Effect.runSync
            )
          }
        }
      }

      setDefaultSignalHandler(signalHandler)

      // FIXME. Uncomment when we know the subscribe listener is always called after assign actions
      // Register db snapshot on transition
      // if (db) {
      //   log.debug('Registering db snapshot handler')
      //   interpreter.subscribe((state) => {
      //     try {
      //       const nextDb = db.getDbSnapshot(state.context)
      //       const prevDb = state.context[dbSnapshotKey]
      //       if (!db.isDbSnapshotEqual(nextDb, prevDb)) {
      //         log.info('Db snapshot value changed', nextDb)
      //         void db
      //           .onNewDbSnapshot(nextDb)
      //           .then((e) => {
      //             // @ts-ignore
      //             log.debug(
      //               'Called ondbsnapshot successfully. Setting db snapshot in context'
      //             )
      //             state.context[dbSnapshotKey] = nextDb
      //           })
      //           .catch((e) => {
      //             log.error('onNewDbSnapshot error:', { error: e })
      //           })
      //       } else {
      //         log.debug('Db value unchanged, skipping call to onNewDbSnapshot')
      //       }
      //     } catch (e) {
      //       log.error('Error persisting db snapshot', { error: e })
      //     }
      //   })
      // }

      // Await machine done
      return await blocker
    } catch (e) {
      log.error('Workflow error', { error: e })
      throw e
    }
  }

  Object.defineProperty(workflow, 'name', { value: name })
  // typeof module !== 'undefined' && (module.exports[name] = workflow)
  return workflow
}
