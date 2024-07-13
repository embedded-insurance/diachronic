import {
  Actor,
  ActorOptions,
  AnyState,
  EventFromLogic,
  StateValue,
} from 'xstate'
import * as S from '@effect/schema/Schema'
// @ts-ignore
import { ActorStatus } from 'xstate/dist/declarations/src/interpreter'
import {
  AnyActorLogic,
  AnyActorRef,
  AnyStateMachine,
  EventObject,
  // @ts-ignore
} from 'xstate/dist/declarations/src/types'
import { CustomClock } from './clock'
import {
  datafyXStateAfterId,
  getDelayFunctionName,
  XStateTimerId,
} from './analysis'
import { defaultLogImpl, Logger } from './logger'

export interface CustomInterpreterOptions<TLogic extends AnyActorLogic>
  extends ActorOptions<TLogic> {
  clock?: CustomClock
  log?: Logger
}

export type TimerDataEntry = {
  id: XStateTimerId
  start: number
  delay: number
  delayId: string | undefined
  stateId: string
  event: { type: string }
}
export type TimerData = Record<XStateTimerId, TimerDataEntry>

export class CustomInterpreter<
  TLogic extends AnyActorLogic,
  TEvent extends EventObject = EventFromLogic<TLogic>
> extends Actor<TLogic, TEvent> {
  public data = {
    timers: {} as TimerData,
  }
  log: Logger

  public override clock: CustomClock
  public _statusExtra: 'STOPPING' | undefined

  get statusExtra(): ActorStatus | 'STOPPING' {
    return this._statusExtra || this.status
  }

  setStatusExtra(x: 'STOPPING' | undefined) {
    this._statusExtra = x
  }

  getTimers() {
    return this.data.timers
  }

  constructor(machine: TLogic, options?: CustomInterpreterOptions<TLogic>) {
    super(machine, options)
    this.clock = options?.clock || new CustomClock()
    this.log = options?.log || defaultLogImpl

    // I think xstate clears timers using this method
    //
    // Sometimes XState calls this for timers that were never scheduled,
    // but have a definition in a state node
    this['cancel'] = (sendId: XStateTimerId) => {
      this.log.debug(
        'Cancelling timer',
        {
          sendId,
          status: this.status,
          statusExtra: this.statusExtra,
        },
        'interpreter.cancel'
      )

      // Invoke the default xstate timer cancellation behavior
      super.cancel(sendId)

      if (!this.data.timers[sendId]) {
        this.log.debug(
          'Timer data not found for timer id ' + sendId,
          { timers: this.data.timers },
          'interpreter.cancel'
        )
        return
      }
      if (this.statusExtra !== 'STOPPING') {
        delete this.data.timers[sendId]
        this.log.debug('Timer data deleted', {
          updatedTimers: this.data.timers,
        })
      }
    }
  }

  public getXStateInternalDelayedEventsMap() {
    return this['delayedEventsMap']
  }

  delaySend(sendAction: {
    event: EventObject
    id: string | undefined
    delay: number
    to?: AnyActorRef
  }) {
    super.delaySend(sendAction)
    const now = this.clock.now()
    if (S.is(XStateTimerId)(sendAction.id)) {
      const timerDescription = datafyXStateAfterId(sendAction.id)
      const delayValueFromId = parseInt(timerDescription.delayId)

      this.data.timers[sendAction.id] = {
        id: sendAction.id,
        start: now,
        delay: sendAction.delay as number,
        stateId: timerDescription.stateId,
        event: sendAction.event,
        delayId: Number.isNaN(delayValueFromId)
          ? timerDescription.delayId
          : // assume means delayId is actually a number representing ms
            undefined,
      }
    } else {
      this.log.error(
        'Failed to parse delay event: ' + sendAction,
        undefined,
        'interpreter.delaySend'
      )
    }
  }

  send(event: TEvent) {
    super.send(event)
  }

  stop(): this {
    this.setStatusExtra('STOPPING')
    const ok = super.stop()
    this.setStatusExtra(undefined)
    return ok
  }
}

export const getTimeLeft = (t: TimerDataEntry, now: number) =>
  t.delay - (now - t.start)

/**
 * Given a set of delayedEventIds and a state, schedules the events
 * according to their delay function upon entering the state
 * @param interpreter
 * @param machine
 * @param initialState
 * @param delayEventsInStateNotRestored
 * @param log
 */
export const startTimersOnStart = (
  interpreter: CustomInterpreter<any>,
  machine: AnyStateMachine,
  initialState: AnyState,
  delayEventsInStateNotRestored: Array<XStateTimerId>,
  log: Logger
) => {
  const sub = interpreter.subscribe((x) => {
    if (!x.matches(initialState.value)) {
      throw new Error(
        'Expected to start in the same state as the persisted state'
      )
    }

    log.info(
      'Interpreter reached start state. Sending new delay events',
      { delayEventsInStateNotRestored },
      'startTimersOnStart'
    )

    delayEventsInStateNotRestored.forEach((delayEvent) => {
      const fnName = getDelayFunctionName(delayEvent)
      const delayFn = machine.implementations.delays[fnName]
      if (!machine.implementations.delays[fnName]) {
        log.error(
          `Expected to find a delay function named ${fnName} but did not`,
          { delayEvent, fnName, delayEventsInStateNotRestored },
          'startTimersOnStart'
        )
        throw new Error(
          'Missing implementation for delay function named ' + fnName
        )
      }
      log.debug(
        `Computing delay value for delay function "${fnName}" and state "${x.value}"`
      )

      let delayValue: number
      try {
        delayValue = delayFn(initialState.context)
        log.debug(
          `Computed delay value ${delayValue} for delay function ${fnName}`,
          undefined,
          'startTimersOnStart'
        )
      } catch (e) {
        log.error(
          'Error computing delay value for delay function',
          { fnName, error: e },
          'startTimersOnStart'
        )
        throw e
      }

      interpreter.delaySend({
        event: { type: delayEvent },
        delay: delayValue,
        id: delayEvent,
        // to support multiple actors
        // to: undefined
      })
    })

    sub.unsubscribe()
  })
}

/**
 * Registers a transition listener that restores timers on start
 * Should be called/registered before `.start()`ing the interpreter
 *
 * @param interpreter
 * @param timers
 * @param startState - StateValue representing the machine's start state.
 * Used to detect when the machine has reached this state upon start
 * @param machine
 * @param log
 */
export const restoreTimersOnStart = <
  Interpreter extends CustomInterpreter<any, any>
>(
  interpreter: Interpreter,
  timers: TimerData,
  startState: StateValue,
  machine: AnyStateMachine,
  log: Logger
) => {
  // restore timers once machine in start state
  // machine must be in this state to receive timer fired event
  const timerReinitSubscription = interpreter.subscribe((x) => {
    if (!x.matches(startState)) {
      throw new Error(
        'Expected to start in the same state as the persisted state'
      )
    }

    log.debug(
      'Machine resumed in expected state:',
      {
        state: x.value,
        context: x.context,
      },
      'restore-timers'
    )

    log.debug('Reinitializing timers...', undefined, 'restore-timers')

    Object.values(timers).forEach((timer) => {
      // todo. should we check if the subject state of this timer still exists in the machine?
      // and only schedule it if it does?
      // the state is on the right side of the timer id and should be parsed as stateId
      // in the `timer` var here (TimerDataEntry type)
      log.debug('Attempting to restore timer', { timer }, 'restore-timers')

      const now = interpreter.clock.now()
      const timeElapsed = now - timer.start
      const timeLeft = timer.delay - timeElapsed
      log.debug('Existing timer has time left', { timeLeft }, 'restore-timers')

      const delayFunctionName = getDelayFunctionName(timer.id)

      if (!machine.implementations.delays[delayFunctionName]) {
        log.error(
          `Previous timer with delay function named "${delayFunctionName}" not found. The existing timer that would have fired at ${new Date(
            interpreter.clock.now() + timeLeft
          ).toISOString()} will not be scheduled as part of this continuation.`,
          undefined,
          'restore-timers'
        )
        return
      }
      const context = interpreter.getSnapshot().context
      const newlyComputedDelay = machine.implementations.delays[
        delayFunctionName
      ]({ context, event: timer.event })

      let delayValueToSet = timeLeft <= 0 ? 1 : timeLeft
      if (newlyComputedDelay !== timer.delay) {
        log.debug(
          'Delay function returned new delay',
          { newlyComputedDelay },
          'restore-timers'
        )

        log.debug('Calculating a new fire at time...')
        const fireAt = timer.start - timeElapsed + newlyComputedDelay
        log.debug(
          `Timer ${timer.id} should fire at ${new Date(
            fireAt
          ).toISOString()} according to new delay value (${newlyComputedDelay}ms)`,
          {},
          'restore-timers'
        )

        const distance = fireAt - now
        log.debug(
          `...that's approximately ${distance}ms ${
            distance < 0 ? 'ago' : distance > 0 ? 'from now' : 'now'
          }`,
          {},
          'restore-timers'
        )

        const newDelayValue = distance <= 0 ? 1 : distance
        log.debug('Setting new delay value to:', { newDelayValue })

        delayValueToSet = newDelayValue
      }

      interpreter.delaySend({
        id: timer.id,
        event: timer.event,
        delay: delayValueToSet,
        // todo. Need `to`...store/serialize the whole original event maybe
        // to: t.stateId,
      })
    })

    timerReinitSubscription.unsubscribe()
  })
}

export function interpret<T extends AnyStateMachine>(
  machine: T,
  options?: CustomInterpreterOptions<T>
): CustomInterpreter<T>

export function interpret<TLogic extends AnyActorLogic>(
  machine: TLogic,
  options?: CustomInterpreterOptions<TLogic>
): CustomInterpreter<TLogic, EventFromLogic<TLogic>>

export function interpret(
  a: any,
  options?: CustomInterpreterOptions<any>
): any {
  return new CustomInterpreter(a, options)
}
