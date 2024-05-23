import { Actor, AnyState, EventFromLogic, StateValue } from 'xstate'
import * as S from '@effect/schema/Schema'
// @ts-ignore
import { ActorStatus } from 'xstate/dist/declarations/src/interpreter'
import {
  AnyActorLogic,
  AnyActorRef,
  AnyStateMachine,
  EventObject,
  InterpreterOptions,
  // @ts-ignore
} from 'xstate/dist/declarations/src/types'
import { CustomClock } from './clock'
import {
  datafyXStateAfterId,
  getDelayFunctionName,
  XStateTimerId,
} from './analysis'

export interface CustomInterpreterOptions<TLogic extends AnyActorLogic>
  extends InterpreterOptions<TLogic> {
  clock?: CustomClock
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

    // I think xstate clears timers using this method
    //
    // Sometimes XState calls this for timers that were never scheduled,
    // but have a definition in a state node
    this['cancel'] = (sendId: XStateTimerId) => {
      console.log('[interpreter] status', this.status)
      // TODO. when/how does this get called typically...?
      console.log('[interpreter] cancelling timer', sendId, {
        'interpreter.status': this.status,
        'interpreter.statusExtra': this.statusExtra,
      })

      // FIXME. what does this method do?
      //  aren't there timers in the clock also?
      super.cancel(sendId)

      if (!this.data.timers[sendId]) {
        console.debug(
          'Timer data not found for timer id',
          sendId,
          'Timers are:',
          this.data.timers
        )
        return
      }
      if (this.statusExtra !== 'STOPPING') {
        delete this.data.timers[sendId]
        console.log('Timer data deleted. Timers are now:', this.data.timers)
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
    // TODO. custom logger
    // console.log('delaySend', sendAction)
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
      console.error('Failed to parse delay event:', sendAction)
    }
  }

  send(event: TEvent) {
    // console.log('gonna send this', event)
    super.send(event)
  }

  stop(): this {
    // console.log('gonna stop this')
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
 */
export const startTimersOnStart = (
  interpreter: CustomInterpreter<any>,
  machine: AnyStateMachine,
  initialState: AnyState,
  delayEventsInStateNotRestored: Array<XStateTimerId>
) => {
  const sub = interpreter.subscribe((x) => {
    if (!x.matches(initialState.value)) {
      throw new Error(
        'Expected to start in the same state as the persisted state'
      )
    }

    console.log(
      'Interpreter reached start state. Sending new delay events',
      delayEventsInStateNotRestored
    )

    delayEventsInStateNotRestored.forEach((delayEvent) => {
      const fnName = getDelayFunctionName(delayEvent)
      const delayFn = machine.implementations.delays[fnName]
      if (!machine.implementations.delays[fnName]) {
        console.error(
          'Expected to find a delay function named ',
          fnName,
          'but did not'
        )
        throw new Error(
          'Missing implementation for delay function named ' + fnName
        )
      }
      console.log(
        `Computing delay value for delay function "${fnName}" and state "${x.value}"`
      )

      let delayValue: number
      try {
        delayValue = delayFn(initialState.context)
        console.debug(
          'Computed delay value',
          delayValue,
          'for delay function',
          fnName
        )
      } catch (e) {
        console.error(
          'Error computing delay value for delay function',
          fnName,
          e
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
 */
export const restoreTimersOnStart = <
  Interpreter extends CustomInterpreter<any, any>
>(
  interpreter: Interpreter,
  timers: TimerData,
  startState: StateValue,
  machine: AnyStateMachine
) => {
  // restore timers once machine in start state
  // machine must be in this state to receive timer fired event
  const timerReinitSubscription = interpreter.subscribe((x) => {
    if (!x.matches(startState)) {
      throw new Error(
        'Expected to start in the same state as the persisted state'
      )
    }

    console.log('[restore-timers] Machine resumed in expected state:', {
      state: x.value,
      context: x.context,
    })

    console.log('[restore-timers] Reinitializing timers...')

    Object.values(timers).forEach((timer) => {
      // todo. should we check if the subject state of this timer still exists in the machine?
      // and only schedule it if it does?
      // the state is on the right side of the timer id and should be parsed as stateId
      // in the `timer` var here (TimerDataEntry type)
      console.log('[restore-timers] Attempting to restore timer', timer)

      const now = interpreter.clock.now()
      const timeElapsed = now - timer.start
      const timeLeft = timer.delay - timeElapsed
      console.log('[restore-timers] Existing timer has time left', timeLeft)

      const delayFunctionName = getDelayFunctionName(timer.id)

      if (!machine.implementations.delays[delayFunctionName]) {
        console.error(
          `Previous timer with delay function named "${delayFunctionName}" not found. The existing timer that would have fired at ${new Date(
            interpreter.clock.now() + timeLeft
          ).toISOString()} will not be scheduled as part of this continuation.`
        )
        return
      }
      const context = interpreter.getSnapshot().context
      const newlyComputedDelay = machine.implementations.delays[
        delayFunctionName
      ]({ context, event: timer.event })

      let delayValueToSet = timeLeft <= 0 ? 1 : timeLeft
      if (newlyComputedDelay !== timer.delay) {
        console.log(
          '[restore-timers] Delay function returned new delay',
          newlyComputedDelay
        )

        console.log('Calculating a new fire at time...')
        const fireAt = timer.start - timeElapsed + newlyComputedDelay
        console.log(
          `Timer ${timer.id} should fire at ${new Date(
            fireAt
          ).toISOString()} according to new delay value (${newlyComputedDelay}ms)`
        )

        const distance = fireAt - now
        console.log(
          `...that's approximately ${distance}ms ${
            distance < 0 ? 'ago' : distance > 0 ? 'from now' : 'now'
          }`
        )

        const newDelayValue = distance <= 0 ? 1 : distance
        console.log('Setting new delay value to:', newDelayValue)

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
  options?: InterpreterOptions<T>
): CustomInterpreter<T>

export function interpret<TLogic extends AnyActorLogic>(
  machine: TLogic,
  options?: InterpreterOptions<TLogic>
): CustomInterpreter<TLogic, EventFromLogic<TLogic>>

export function interpret(a: any, options?: InterpreterOptions<any>): any {
  return new CustomInterpreter(a, options)
}
